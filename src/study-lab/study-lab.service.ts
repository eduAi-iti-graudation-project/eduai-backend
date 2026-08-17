import {
  Injectable,
  Logger,
  HttpStatus,
  NotFoundException,
  BadGatewayException,
  OnModuleInit,
} from '@nestjs/common';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import PptxGenJS from 'pptxgenjs';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService } from '../auth/supabase.service';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';
import { StudyLabGenerators } from './study-lab.generators';
import { StudyLabGatewayService } from './study-lab.gateway.service';
import { Prisma } from '@prisma/client';
import type { GenerateStudyDto, GenerateStudyTheme } from './dto';
import type { Deck } from './schemas';
import { buildDeckModel } from './pptx-deck';
import { renderSlideVisuals } from './visual-renderer';

const execFileAsync = promisify(execFile);
const DEFAULT_BUCKET = 'materials';
const MAX_GENERATION_MS = 5 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX = 10;

@Injectable()
export class StudyLabService implements OnModuleInit {
  private readonly logger = new Logger(StudyLabService.name);
  private readonly bucket: string;
  private readonly rateLimitMap = new Map<
    string,
    { count: number; resetAt: number }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly generators: StudyLabGenerators,
    private readonly gateway: StudyLabGatewayService,
    private readonly supabase: SupabaseService,
  ) {
    this.bucket = process.env.SUPABASE_STORAGE_BUCKET || DEFAULT_BUCKET;
  }

  private checkRateLimit(studentId: string): void {
    const now = Date.now();
    const record = this.rateLimitMap.get(studentId);
    if (!record || record.resetAt < now) {
      this.rateLimitMap.set(studentId, {
        count: 1,
        resetAt: now + RATE_LIMIT_WINDOW_MS,
      });
      return;
    }
    if (record.count >= RATE_LIMIT_MAX) {
      throw new ApiError(
        ErrorCode.RATE_LIMITED,
        HttpStatus.TOO_MANY_REQUESTS,
        `You have reached the maximum of ${RATE_LIMIT_MAX} generations per hour. Please try again later.`,
      );
    }
    record.count++;
  }

  async onModuleInit(): Promise<void> {
    const cutoff = new Date(Date.now() - MAX_GENERATION_MS);
    const stuck = await this.prisma.studyGeneration.updateMany({
      where: {
        status: 'PROCESSING',
        updatedAt: { lt: cutoff },
      },
      data: {
        status: 'FAILED',
        error: 'Generation timed out; please try again.',
        stage: 'FAILED',
      },
    });
    if (stuck.count > 0) {
      this.logger.warn(
        `[study-lab] recovered ${stuck.count} stale generation(s) from a previous run`,
      );
    }
  }

  async submit(
    studentId: string,
    dto: GenerateStudyDto,
  ): Promise<{ generationId: string; status: string }> {
    this.checkRateLimit(studentId);

    const activeAttempt = await this.prisma.quizAttempt.findFirst({
      where: { studentId, status: 'IN_PROGRESS' },
      select: { id: true },
    });
    if (activeAttempt) {
      throw new ApiError(
        ErrorCode.HOMEWORK_FORBIDDEN,
        HttpStatus.CONFLICT,
        'You cannot generate study materials while a quiz is in progress.',
      );
    }

    const offering = await this.prisma.courseOffering.findUnique({
      where: { id: dto.courseOfferingId },
      select: { id: true },
    });
    if (!offering) {
      throw new ApiError(
        ErrorCode.OFFERING_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This course offering could not be found.',
      );
    }

    if (dto.kind === 'STUDY_MATERIAL' && !dto.materialKind) {
      throw new ApiError(
        ErrorCode.BAD_REQUEST,
        HttpStatus.BAD_REQUEST,
        'materialKind is required when kind is STUDY_MATERIAL.',
      );
    }

    const generation = await this.launchGeneration(
      studentId,
      dto.courseOfferingId,
      {
        kind: dto.kind,
        materialKind: dto.materialKind ?? null,
        preset: dto.preset ?? null,
        theme: dto.theme,
        topic: dto.topic,
      },
    );

    return { generationId: generation.id, status: 'PROCESSING' };
  }

  async retry(
    studentId: string,
    generationId: string,
  ): Promise<{ generationId: string; status: string }> {
    const existing = await this.prisma.studyGeneration.findUnique({
      where: { id: generationId },
    });

    if (!existing || existing.studentId !== studentId) {
      throw new ApiError(
        ErrorCode.NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'Study generation not found.',
      );
    }

    if (existing.status === 'PROCESSING') {
      return { generationId: existing.id, status: 'PROCESSING' };
    }

    this.checkRateLimit(studentId);

    const updated = await this.prisma.studyGeneration.update({
      where: { id: generationId },
      data: {
        status: 'PROCESSING',
        stage: 'QUEUED',
        error: null,
      },
    });

    void this.processGeneration(updated.id).catch((err: unknown) => {
      this.logger.error(
        `[study-lab] background retry pipeline crashed for ${updated.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    return { generationId: updated.id, status: 'PROCESSING' };
  }

  async recommend(
    studentId: string,
    courseOfferingId: string,
    topic: string,
    analysisId: string,
  ): Promise<string> {
    const existing = await this.prisma.studyGeneration.findFirst({
      where: {
        studentId,
        recommendedForAnalysisId: analysisId,
        status: { in: ['PROCESSING', 'READY'] },
      },
      select: { id: true },
    });
    if (existing) {
      this.logger.log(
        `[study-lab] recommendation already exists (${existing.id}) for analysis ${analysisId}`,
      );
      return existing.id;
    }

    const generation = await this.launchGeneration(
      studentId,
      courseOfferingId,
      {
        kind: 'STUDY_MATERIAL',
        materialKind: 'PRACTICE_QUESTIONS',
        preset: null,
        topic,
        recommendedForAnalysisId: analysisId,
      },
    );
    return generation.id;
  }

  private async launchGeneration(
    studentId: string,
    courseOfferingId: string,
    input: {
      kind: string;
      materialKind: string | null;
      preset: string | null;
      theme?: GenerateStudyTheme;
      topic: string;
      recommendedForAnalysisId?: string;
    },
  ) {
    const generation = await this.prisma.studyGeneration.create({
      data: {
        studentId,
        courseOfferingId,
        kind: input.kind,
        materialKind: input.materialKind,
        preset: input.preset,
        theme: input.theme
          ? (input.theme as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        topic: input.topic,
        recommendedForAnalysisId: input.recommendedForAnalysisId ?? null,
        status: 'PROCESSING',
        stage: 'QUEUED',
        sources: [],
      },
    });

    void this.processGeneration(generation.id).catch((err: unknown) => {
      this.logger.error(
        `[study-lab] background pipeline crashed for ${generation.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    return generation;
  }

  private async processGeneration(generationId: string): Promise<void> {
    const generation = await this.prisma.studyGeneration.findUnique({
      where: { id: generationId },
    });
    if (!generation || generation.status !== 'PROCESSING') return;

    try {
      await this.updateStage(generationId, 'GROUNDING');
      const chunks = await this.generators.ground(
        generation.courseOfferingId,
        generation.topic,
        12,
      );
      if (chunks.chunks.length === 0) {
        this.logger.warn(
          `[study-lab] no curriculum material found for "${generation.topic}" in ${generation.courseOfferingId} — generating from general knowledge (ungrounded).`,
        );
        await this.prisma.studyGeneration.update({
          where: { id: generationId },
          data: { sources: [] },
        });
      } else {
        await this.prisma.studyGeneration.update({
          where: { id: generationId },
          data: { sources: chunks.sources },
        });
      }

      await this.updateStage(generationId, 'GENERATING');
      const { payload, audioUrl, fileUrl, durationSeconds } =
        await this.generatePayload(generationId, generation);

      await this.updateStage(generationId, 'BUILDING');
      const built = await this.buildArtifacts(
        generationId,
        generation,
        payload,
        audioUrl,
        fileUrl,
        durationSeconds,
      );

      await this.prisma.studyGeneration.update({
        where: { id: generationId },
        data: {
          status: 'READY',
          stage: 'DONE',
          payload: built.payload as Prisma.InputJsonValue,
          audioUrl: built.audioUrl ?? null,
          fileUrl: built.fileUrl ?? null,
          durationSeconds: built.durationSeconds ?? null,
          completedAt: new Date(),
        },
      });
      this.logger.log(`[study-lab] generation ${generationId} completed`);
    } catch (err: unknown) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Generation failed unexpectedly.';
      this.logger.error(
        `[study-lab] generation ${generationId} failed: ${message}`,
      );
      await this.prisma.studyGeneration.update({
        where: { id: generationId },
        data: { status: 'FAILED', stage: 'FAILED', error: message },
      });
    }
  }

  private async generatePayload(
    generationId: string,
    generation: {
      kind: string;
      materialKind: string | null;
      preset: string | null;
      theme?: unknown;
      courseOfferingId: string;
      topic: string;
    },
  ): Promise<{
    payload: unknown;
    audioUrl?: string;
    fileUrl?: string;
    durationSeconds?: number;
  }> {
    switch (generation.kind) {
      case 'PODCAST': {
        const script = await this.generators.podcastScript(
          generation.courseOfferingId,
          generation.topic,
          generation.preset ?? 'OVERVIEW',
        );
        const audio = await this.buildPodcastAudio(
          generationId,
          generation.courseOfferingId,
          script,
        );
        return {
          payload: { ...script, audioAvailable: audio?.url ? true : false },
          audioUrl: audio?.url,
          durationSeconds: audio?.durationSeconds,
        };
      }
      case 'SLIDES': {
        const deck = await this.generators.deck(
          generation.courseOfferingId,
          generation.topic,
          generation.theme as GenerateStudyTheme | undefined,
        );
        return { payload: deck };
      }
      case 'STUDY_MATERIAL': {
        const payload = await this.generateMaterial(
          generation.courseOfferingId,
          generation.topic,
          generation.materialKind,
        );
        return { payload };
      }
      default:
        throw new Error(`Unknown generation kind: ${generation.kind}`);
    }
  }

  private async generateMaterial(
    courseOfferingId: string,
    topic: string,
    materialKind: string | null,
  ): Promise<unknown> {
    switch (materialKind) {
      case 'STUDY_GUIDE':
        return this.generators.studyGuide(courseOfferingId, topic);
      case 'FLASHCARDS':
        return this.generators.flashcards(courseOfferingId, topic);
      case 'PRACTICE_QUESTIONS':
        return this.generators.practiceSet(courseOfferingId, topic);
      case 'CHEAT_SHEET':
        return this.generators.cheatSheet(courseOfferingId, topic);
      default:
        throw new Error(`Unknown material kind: ${materialKind}`);
    }
  }

  private async buildArtifacts(
    generationId: string,
    generation: { kind: string; courseOfferingId: string },
    payload: unknown,
    audioUrl?: string,
    fileUrl?: string,
    durationSeconds?: number,
  ): Promise<{
    payload: unknown;
    audioUrl?: string | null;
    fileUrl?: string | null;
    durationSeconds?: number;
  }> {
    if (generation.kind !== 'SLIDES') {
      return { payload, audioUrl, fileUrl, durationSeconds };
    }

    try {
      const deck = payload as Deck;
      const visualPngs = renderSlideVisuals(deck);
      const buffer = await this.buildPptx(deck, visualPngs);
      const objectPath = `${this.bucket}/${generation.courseOfferingId}/study-lab/${generationId}.pptx`;
      const { error } = await this.supabase
        .getStorageClient()
        .storage.from(this.bucket)
        .upload(objectPath, buffer, {
          contentType:
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          upsert: true,
        });
      if (error) {
        throw new Error(`Slide storage upload failed: ${error.message}`);
      }
      this.logger.log(`[study-lab] slides uploaded to ${objectPath}`);
      return { payload, audioUrl, fileUrl: objectPath };
    } catch (err) {
      this.logger.warn(
        `[study-lab] pptx build failed for ${generationId}: ${err instanceof Error ? err.message : String(err)} — slides remain available as JSON`,
      );
      return { payload, audioUrl, fileUrl: null };
    }
  }

  private async buildPodcastAudio(
    generationId: string,
    courseOfferingId: string,
    script: { segments: { speaker: 'HOST' | 'GUEST'; text: string }[] },
  ): Promise<{ url?: string; durationSeconds?: number }> {
    if (!this.gateway.audioEnabled) {
      this.logger.log(
        '[study-lab] audio disabled (no TTS provider configured — set STUDY_AUDIO_MODEL or KOKORO_TTS_URL) — script-only podcast',
      );
      return {};
    }

    this.logger.log(
      `[study-lab] podcast audio via provider=${this.gateway.providerName}`,
    );

    const dir = await mkdtemp(join(tmpdir(), 'study-lab-'));
    const segmentFiles: string[] = [];
    try {
      const CONCURRENCY = 3;
      const results: { i: number; buffer: Buffer }[] = [];
      for (let i = 0; i < script.segments.length; i += CONCURRENCY) {
        const batch = script.segments.slice(i, i + CONCURRENCY);
        const settled = await Promise.allSettled(
          batch.map((seg, idx) =>
            this.gateway
              .synthesizeSpeech(seg.text, this.gateway.voicesFor(seg.speaker))
              .then(({ buffer }) => ({ i: i + idx, buffer })),
          ),
        );
        for (const r of settled) {
          if (r.status === 'fulfilled') {
            results.push(r.value);
          } else {
            this.logger.warn(
              `[study-lab] TTS segment failed: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`,
            );
          }
        }
      }

      if (results.length === 0) {
        throw new Error('All TTS segments failed');
      }

      results.sort((a, b) => a.i - b.i);
      for (const { i, buffer } of results) {
        const file = join(dir, `seg-${String(i).padStart(3, '0')}.mp3`);
        await writeFile(file, buffer);
        segmentFiles.push(file);
      }

      const listFile = join(dir, 'list.txt');
      await writeFile(
        listFile,
        segmentFiles.map((f) => `file '${f}'`).join('\n'),
      );
      const outFile = join(dir, 'podcast.mp3');
      await execFileAsync('ffmpeg', [
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        listFile,
        '-c:a',
        'libmp3lame',
        '-q:a',
        '4',
        outFile,
      ]);

      const audio = await readFile(outFile);
      const duration = await this.probeDuration(outFile);
      const objectPath = `${this.bucket}/${courseOfferingId}/study-lab/${generationId}.mp3`;
      const { error } = await this.supabase
        .getStorageClient()
        .storage.from(this.bucket)
        .upload(objectPath, audio, {
          contentType: 'audio/mpeg',
          upsert: true,
        });
      if (error) {
        throw new Error(`Audio storage upload failed: ${error.message}`);
      }
      this.logger.log(
        `[study-lab] podcast audio uploaded to ${objectPath} (${duration}s)`,
      );
      return { url: objectPath, durationSeconds: duration };
    } catch (err) {
      this.logger.error(
        `[study-lab] podcast audio pipeline failed for ${generationId}: ${err instanceof Error ? err.message : String(err)} — falling back to script-only`,
      );
      return {};
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private async buildPptx(
    deck: Deck,
    visualPngs?: (Buffer | null)[],
  ): Promise<Buffer> {
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE';
    const model = buildDeckModel(deck, visualPngs);

    for (const slideModel of model.slides) {
      const slide = pptx.addSlide();
      if (slideModel.background) {
        slide.background = { color: slideModel.background };
      }
      for (const shape of slideModel.shapes) {
        slide.addShape(
          shape.shapeType === 'roundRect'
            ? pptx.ShapeType.roundRect
            : pptx.ShapeType.rect,
          {
            x: shape.x,
            y: shape.y,
            w: shape.w,
            h: shape.h,
            fill: { color: shape.fill ?? '000000' },
            line: shape.line
              ? { color: shape.line.color, width: shape.line.width }
              : undefined,
          },
        );
      }
      for (const tb of slideModel.textboxes) {
        const runs = tb.runs.map((r) => ({
          text: r.text,
          options: r.options,
        }));
        slide.addText(runs, {
          x: tb.x,
          y: tb.y,
          w: tb.w,
          h: tb.h,
          ...tb.options,
        });
      }
      for (const img of slideModel.images) {
        slide.addImage({
          data: `image/png;base64,${img.data.toString('base64')}`,
          x: img.x,
          y: img.y,
          w: img.w,
          h: img.h,
          sizing: { type: 'contain', w: img.w, h: img.h },
        });
      }
      if (slideModel.notes) {
        slide.addNotes(slideModel.notes);
      }
    }

    return Buffer.from(
      (await pptx.write({ outputType: 'nodebuffer' })) as Buffer,
    );
  }

  private async probeDuration(file: string): Promise<number> {
    try {
      const { stdout } = await execFileAsync('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'csv=p=0',
        file,
      ]);
      return Math.round(parseFloat(stdout.trim()));
    } catch {
      return 0;
    }
  }

  private async updateStage(
    generationId: string,
    stage: string,
  ): Promise<void> {
    await this.prisma.studyGeneration.update({
      where: { id: generationId },
      data: { stage },
    });
  }

  async getStudentOfferings(studentId: string) {
    const sections = await this.prisma.section.findMany({
      where: {
        enrollments: {
          some: { studentId, status: 'APPROVED' },
        },
      },
      include: {
        offerings: {
          include: { course: true },
        },
      },
    });

    // Each student is in exactly one section per grade, so one offering per
    // course. Return one entry per course — the section is implied by the
    // student's enrollment and never shown.
    const seen = new Set<string>();
    const entries: {
      offeringId: string;
      courseId: string;
      courseName: string;
      materialCount: number;
    }[] = [];
    const offeringIds: string[] = [];
    for (const s of sections) {
      for (const o of s.offerings) {
        if (seen.has(o.courseId)) continue;
        seen.add(o.courseId);
        offeringIds.push(o.id);
        entries.push({
          offeringId: o.id,
          courseId: o.courseId,
          courseName: o.course.name,
          materialCount: 0,
        });
      }
    }

    if (offeringIds.length > 0) {
      const visible = await this.prisma.material.findMany({
        where: {
          OR: [
            { courseOfferingId: { in: offeringIds } },
            {
              scopes: { some: { courseOfferingId: { in: offeringIds } } },
            },
          ],
        },
        select: {
          courseOfferingId: true,
          scopes: { select: { courseOfferingId: true } },
        },
      });
      const countById = new Map<string, number>();
      for (const m of visible) {
        const ids = m.courseOfferingId
          ? [m.courseOfferingId, ...m.scopes.map((s) => s.courseOfferingId)]
          : m.scopes.map((s) => s.courseOfferingId);
        for (const id of new Set(ids)) {
          countById.set(id, (countById.get(id) ?? 0) + 1);
        }
      }
      for (const e of entries) {
        e.materialCount = countById.get(e.offeringId) ?? 0;
      }
    }

    return { offerings: entries };
  }

  async getHistory(studentId: string, courseOfferingId?: string) {
    const generations = await this.prisma.studyGeneration.findMany({
      where: {
        studentId,
        ...(courseOfferingId ? { courseOfferingId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return {
      generations: generations.map((g) => this.serialize(g)),
    };
  }

  async getDetail(studentId: string, generationId: string) {
    const generation = await this.prisma.studyGeneration.findFirst({
      where: { id: generationId, studentId },
    });
    if (!generation) {
      throw new NotFoundException('This study generation could not be found.');
    }
    return { generation: this.serialize(generation) };
  }

  async remove(studentId: string, generationId: string): Promise<void> {
    const generation = await this.prisma.studyGeneration.findFirst({
      where: { id: generationId, studentId },
      select: { id: true, audioUrl: true, fileUrl: true },
    });
    if (!generation) {
      throw new NotFoundException('This study generation could not be found.');
    }
    for (const path of [generation.audioUrl, generation.fileUrl]) {
      if (path) {
        try {
          await this.supabase
            .getStorageClient()
            .storage.from(this.bucket)
            .remove([path]);
        } catch {
          this.logger.warn(`[study-lab] failed to remove ${path}`);
        }
      }
    }
    await this.prisma.studyGeneration.delete({ where: { id: generationId } });
  }

  async download(studentId: string, generationId: string) {
    const generation = await this.prisma.studyGeneration.findFirst({
      where: { id: generationId, studentId },
    });
    if (!generation) {
      throw new NotFoundException('This study generation could not be found.');
    }
    const fileUrl = generation.fileUrl ?? generation.audioUrl;
    if (!fileUrl) {
      throw new BadGatewayException(
        'This generation has no downloadable file. If it is a podcast, open it in the player instead.',
      );
    }
    const { data, error } = await this.supabase
      .getStorageClient()
      .storage.from(this.bucket)
      .download(fileUrl);
    if (error || !data) {
      throw new BadGatewayException(
        'Failed to download the file from storage.',
      );
    }
    return {
      buffer: Buffer.from(await data.arrayBuffer()),
      contentType: fileUrl.endsWith('.pptx')
        ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
        : 'audio/mpeg',
      filename: fileUrl.split('/').pop() ?? 'study-file',
    };
  }

  private serialize(g: Prisma.StudyGenerationGetPayload<true>) {
    return {
      id: g.id,
      kind: g.kind,
      materialKind: g.materialKind,
      preset: g.preset,
      topic: g.topic,
      status: g.status,
      stage: g.stage,
      error: g.error,
      recommendedForAnalysisId: g.recommendedForAnalysisId,
      createdAt: g.createdAt.toISOString(),
      completedAt: g.completedAt?.toISOString() ?? null,
      payload: g.payload ?? null,
      audioUrl: g.audioUrl,
      fileUrl: g.fileUrl,
    };
  }
}
