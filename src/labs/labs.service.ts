import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { User } from '@prisma/client';
import { LlmService } from '../common/llm/llm.service';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';
import { MaterialsService } from '../materials/materials.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildLabGenerationPrompt,
  createLabGenerator,
  LabGeneratorOutputSchema,
  type LabGenerator,
  type LabGeneratorOutput,
} from './agents/lab-generator.agent';
import {
  buildLabArchitectPrompt,
  createLabArchitect,
  LabGameSpecSchema,
  type LabArchitect,
  type LabGameSpec,
} from './agents/lab-architect.agent';
import type {
  GenerateLabDto,
  GenerateLabResponseDto,
  LabDto,
  LabAgentStep,
} from './dto';

const PENDING_LAB_STATUSES = [
  'GENERATING',
  'AI_REVIEW_FAILED',
  'PENDING_TEACHER_REVIEW',
] as const;

/** Statuses a teacher may request an in-place AI modification for. */
const REFINEABLE_LAB_STATUSES = [
  'AI_REVIEW_FAILED',
  'PENDING_TEACHER_REVIEW',
] as const;

/** Statuses a teacher may restart (regenerate from scratch, in place). */
const RESTARTABLE_LAB_STATUSES = [
  'AI_REVIEW_FAILED',
  'PENDING_TEACHER_REVIEW',
] as const;

type LabWithOfferings = Prisma.LabGetPayload<{ include: { offerings: true } }>;

/**
 * AI-generated interactive labs.
 *
 * Two generation paths:
 *  - TEMPLATE (default): a "lab architect" agent writes a compact game spec
 *    (which fixed template + content data) grounded in the selected unit's
 *    material. The frontend renders the game with hand-written, pre-tested
 *    React templates, so interaction and the win condition are guaranteed.
 *    No AI code and no LLM safety review — nothing to hallucinate.
 *  - ADVANCED (opt-in): free-form generation of any self-contained
 *    interactive game code, checked by deterministic plain-code guards
 *    (empty output, missing render target) instead of an LLM reviewer —
 *    the sandbox itself and the teacher's manual review handle the rest.
 * Both keep the same lifecycle: GENERATING -> PENDING_TEACHER_REVIEW (or
 * AI_REVIEW_FAILED), then teacher publish/reject. Students only ever see
 * PUBLISHED labs.
 */
@Injectable()
export class LabsService {
  private readonly logger = new Logger(LabsService.name);

  /** Top-k curriculum chunks fed to the architect / generator. */
  private static readonly GROUNDING_TOP_K = 8;
  /** Max unit chunks fed to the architect / generator when the semantic search is empty. */
  private static readonly CHAPTER_CHUNK_LIMIT = 12;
  /** Agent output retries before giving up (mirrors the validate-with-retry pattern). */
  private static readonly AGENT_ATTEMPTS = 3;

  private readonly architect: LabArchitect;
  private readonly generator: LabGenerator;

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly materials: MaterialsService,
  ) {
    this.architect = createLabArchitect((systemPrompt, userPrompt) =>
      this.llm.chat(systemPrompt, userPrompt),
    );
    this.generator = createLabGenerator((systemPrompt, userPrompt) =>
      this.llm.chat(systemPrompt, userPrompt),
    );
  }

  /**
   * Generate a lab for the selected unit. Default mode is 'template' — a fast,
   * reliable game spec; 'advanced' runs free-form interactive game code
   * generation checked by deterministic plain-code guards (empty output /
   * missing render target). A unit with no curriculum material is a "not
   * grounded" result — no lab row is created.
   */
  async generate(
    user: User,
    dto: GenerateLabDto,
    onStep?: (step: LabAgentStep) => void,
  ): Promise<GenerateLabResponseDto> {
    onStep?.('thinking');
    // Every selected offering must exist in the org, and all of them must
    // belong to the SAME course — a lab grounds its prompt in one course's
    // curriculum, so it can only ever span sections of that course.
    const offerings = await this.prisma.courseOffering.findMany({
      where: {
        id: { in: dto.courseOfferingIds },
        organizationId: user.organizationId ?? undefined,
      },
    });
    if (offerings.length !== dto.courseOfferingIds.length) {
      throw new ApiError(
        ErrorCode.LAB_FORBIDDEN,
        HttpStatus.NOT_FOUND,
        'Some of the selected sections could not be found.',
      );
    }
    const byId = new Map(offerings.map((o) => [o.id, o]));
    const ordered = dto.courseOfferingIds
      .map((id) => byId.get(id))
      .filter((o): o is NonNullable<typeof o> => Boolean(o));
    if (new Set(ordered.map((o) => o.courseId)).size !== 1) {
      throw new ApiError(
        ErrorCode.LAB_FORBIDDEN,
        HttpStatus.BAD_REQUEST,
        'All sections of a lab must belong to the same course.',
      );
    }
    // The first selected section is the primary: its curriculum grounds the
    // topic, and it is what the lab is displayed under.
    const primary = ordered[0];

    // Grounding — scoped to the selected unit (chapter), with the unit's raw
    // chunks as the fallback when a semantic match comes up empty.
    onStep?.('search_curriculum');
    let chunks = await this.materials.searchChunksByCourse(
      primary.courseId,
      dto.prompt,
      LabsService.GROUNDING_TOP_K,
      dto.chapterId,
    );
    if (chunks.length === 0) {
      chunks = await this.materials.getChunksByChapter(
        primary.courseId,
        dto.chapterId,
        LabsService.CHAPTER_CHUNK_LIMIT,
      );
    }
    if (chunks.length === 0) {
      this.logger.log(
        `[labs] unit ${dto.chapterId} of course ${primary.courseId} has no material for offering ${primary.id}`,
      );
      return {
        grounded: false,
        labId: null,
        status: null,
        message:
          'The selected unit has no curriculum material, so a lab cannot be generated for it. Upload and group material into units first, then try again.',
        reviewApproved: null,
        reviewFlags: null,
      };
    }

    const lab = await this.prisma.lab.create({
      data: {
        organizationId: user.organizationId!,
        courseOfferingId: primary.id,
        createdBy: user.id,
        topic: dto.prompt,
        chapterId: dto.chapterId,
        status: 'GENERATING',
        offerings: {
          create: ordered.map((o) => ({ courseOfferingId: o.id })),
        },
      },
      include: { offerings: true },
    });

    const curriculum = this.buildCurriculum(chunks);

    try {
      if (dto.mode === 'advanced') {
        return await this.runLegacyGeneration(
          lab,
          curriculum,
          dto.prompt,
          onStep,
        );
      }
      // Template path: the architect writes the game spec; no reviewer needed.
      onStep?.('design_game');
      const spec = await this.runArchitect(
        buildLabArchitectPrompt({ topic: dto.prompt, curriculum }),
      );
      await this.prisma.lab.update({
        where: { id: lab.id },
        data: {
          status: 'PENDING_TEACHER_REVIEW',
          template: spec.template,
          gameSpec: spec,
          reviewApproved: null,
          reviewFlags: Prisma.DbNull,
        },
        include: { offerings: true },
      });
      this.logger.log(
        `[labs] lab ${lab.id} built with template ${spec.template}`,
      );
      return {
        grounded: true,
        labId: lab.id,
        status: 'PENDING_TEACHER_REVIEW',
        message: null,
        reviewApproved: null,
        reviewFlags: null,
      };
    } catch (error) {
      // The AI pipeline itself failed (provider down, schema validation
      // exhausted, ...). The lab lands in AI_REVIEW_FAILED with a truthful
      // flag so the teacher can regenerate — never a silent GENERATING row.
      const reason = error instanceof Error ? error.message : String(error);
      await this.prisma.lab.update({
        where: { id: lab.id },
        data: {
          status: 'AI_REVIEW_FAILED',
          reviewApproved: false,
          reviewFlags: {
            flags: ['The AI generation pipeline failed.'],
            reasoning: reason,
          },
        },
        include: { offerings: true },
      });
      this.logger.error(
        `[labs] generation pipeline failed for ${lab.id}: ${reason}`,
      );
      return {
        grounded: true,
        labId: lab.id,
        status: 'AI_REVIEW_FAILED',
        message:
          'The AI generation pipeline failed. See the review flags for details.',
        reviewApproved: false,
        reviewFlags: {
          flags: ['The AI generation pipeline failed.'],
          reasoning: reason,
        },
      };
    }
  }

  /**
   * Teacher publish — from PENDING_TEACHER_REVIEW, or from AI_REVIEW_FAILED as
   * a deliberate teacher override. The teacher may verify the flagged code
   * themselves and publish it anyway; the review flags stay on the row so the
   * override is visible to anyone who looks.
   */
  async publish(user: User, labId: string): Promise<LabDto> {
    const lab = await this.findOwned(user, labId);
    if (
      lab.status !== 'PENDING_TEACHER_REVIEW' &&
      lab.status !== 'AI_REVIEW_FAILED'
    ) {
      throw new ApiError(
        ErrorCode.LAB_NOT_PUBLISHABLE,
        HttpStatus.BAD_REQUEST,
        'Only labs pending teacher review can be published.',
      );
    }
    const updated = await this.prisma.lab.update({
      where: { id: lab.id },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
      include: { offerings: true },
    });
    return this.toDto(updated);
  }

  /** Teacher reject — any non-final status, with optional notes. */
  async reject(user: User, labId: string, notes?: string): Promise<LabDto> {
    const lab = await this.findOwned(user, labId);
    const pending: readonly string[] = PENDING_LAB_STATUSES;
    if (!pending.includes(lab.status)) {
      throw new ApiError(
        ErrorCode.LAB_NOT_REJECTABLE,
        HttpStatus.BAD_REQUEST,
        'Only labs that are not yet published or rejected can be rejected.',
      );
    }
    const updated = await this.prisma.lab.update({
      where: { id: lab.id },
      data: { status: 'REJECTED', teacherNotes: notes ?? null },
      include: { offerings: true },
    });
    return this.toDto(updated);
  }

  /**
   * Iterative refinement: the teacher points at a part of an existing lab that
   * isn't right. Template labs get their game spec modified in place (never
   * from scratch); legacy labs get their generated code modified and re-reviewed.
   */
  async refine(
    user: User,
    labId: string,
    instruction: string,
    onStep?: (step: LabAgentStep) => void,
  ): Promise<GenerateLabResponseDto> {
    onStep?.('thinking');
    const lab = await this.findOwned(user, labId);
    const refineable: readonly string[] = REFINEABLE_LAB_STATUSES;
    const isTemplate = Boolean(lab.template) && Boolean(lab.gameSpec);
    if (!refineable.includes(lab.status)) {
      throw new ApiError(
        ErrorCode.LAB_NOT_REFINABLE,
        HttpStatus.BAD_REQUEST,
        'Only labs awaiting teacher review can be refined.',
      );
    }
    if (!isTemplate && !lab.generatedCode) {
      throw new ApiError(
        ErrorCode.LAB_NOT_REFINABLE,
        HttpStatus.BAD_REQUEST,
        'This lab has no content to refine.',
      );
    }

    const curriculum = await this.loadCurriculum(lab);
    if (!curriculum) {
      return {
        grounded: false,
        labId: lab.id,
        status: lab.status,
        message:
          'The selected unit has no curriculum material, so the lab cannot be refined. Upload and group material into units first, then try again.',
        reviewApproved: null,
        reviewFlags: null,
      };
    }
    onStep?.('load_lab');

    try {
      if (isTemplate) {
        onStep?.('modify_lab');
        const spec = await this.runArchitect(
          buildLabArchitectPrompt({
            topic: lab.topic,
            curriculum,
            previousSpec: lab.gameSpec as LabGameSpec,
            instruction,
          }),
        );
        await this.prisma.lab.update({
          where: { id: lab.id },
          data: {
            status: 'PENDING_TEACHER_REVIEW',
            gameSpec: spec,
            reviewApproved: null,
            reviewFlags: Prisma.DbNull,
          },
          include: { offerings: true },
        });
        this.logger.log(
          `[labs] lab ${lab.id} refined (template ${spec.template})`,
        );
        return {
          grounded: true,
          labId: lab.id,
          status: 'PENDING_TEACHER_REVIEW',
          message: null,
          reviewApproved: null,
          reviewFlags: null,
        };
      }

      // Legacy path: modify the existing code in place, in a single pass with
      // no reviewer and no fix loop — the sandbox and the teacher's manual
      // review handle the rest. Only the deterministic plain-code guards
      // (empty output, missing render target) can fail it.
      onStep?.('modify_lab');
      const { code } = await this.runGenerator(
        buildLabGenerationPrompt({
          topic: lab.topic,
          curriculum,
          previousCode: lab.generatedCode!,
          instruction,
        }),
      );
      const guard = this.guardGeneratedCode(code);
      const status = guard
        ? ('AI_REVIEW_FAILED' as const)
        : ('PENDING_TEACHER_REVIEW' as const);
      await this.prisma.lab.update({
        where: { id: lab.id },
        data: {
          status,
          generatedCode: code,
          reviewApproved: guard ? false : null,
          reviewFlags: guard
            ? { flags: guard.flags, reasoning: guard.reasoning }
            : Prisma.DbNull,
        },
        include: { offerings: true },
      });
      this.logger.log(
        `[labs] lab ${lab.id} refined → ${guard ? 'guarded' : 'ok'} (single pass)`,
      );
      return {
        grounded: true,
        labId: lab.id,
        status,
        message: null,
        reviewApproved: guard ? false : null,
        reviewFlags: guard
          ? { flags: guard.flags, reasoning: guard.reasoning }
          : null,
      };
    } catch (error) {
      // Keep the previous content; only the review state moves to
      // AI_REVIEW_FAILED so the teacher can refine/regenerate again.
      const reason = error instanceof Error ? error.message : String(error);
      await this.prisma.lab.update({
        where: { id: lab.id },
        data: {
          status: 'AI_REVIEW_FAILED',
          reviewApproved: false,
          reviewFlags: {
            flags: ['The AI refinement pipeline failed.'],
            reasoning: reason,
          },
        },
        include: { offerings: true },
      });
      this.logger.error(
        `[labs] refinement pipeline failed for ${lab.id}: ${reason}`,
      );
      return {
        grounded: true,
        labId: lab.id,
        status: 'AI_REVIEW_FAILED',
        message:
          'The AI refinement pipeline failed. See the review flags for details.',
        reviewApproved: false,
        reviewFlags: {
          flags: ['The AI refinement pipeline failed.'],
          reasoning: reason,
        },
      };
    }
  }

  /**
   * Restart (regenerate) the SAME lab from scratch — a fresh architect call /
   * fresh code generation, ignoring the previous content. Prefer this over
   * refine when the current lab is beyond repair.
   */
  async regenerate(
    user: User,
    labId: string,
    onStep?: (step: LabAgentStep) => void,
  ): Promise<GenerateLabResponseDto> {
    onStep?.('thinking');
    const lab = await this.findOwned(user, labId);
    const restartable: readonly string[] = RESTARTABLE_LAB_STATUSES;
    if (!restartable.includes(lab.status)) {
      throw new ApiError(
        ErrorCode.LAB_NOT_RESTARTABLE,
        HttpStatus.BAD_REQUEST,
        'Only labs that are not yet published or rejected can be regenerated.',
      );
    }
    const isTemplate = Boolean(lab.template) && Boolean(lab.gameSpec);

    onStep?.('search_curriculum');
    const curriculum = await this.loadCurriculum(lab);
    if (!curriculum) {
      return {
        grounded: false,
        labId: lab.id,
        status: lab.status,
        message:
          'The selected unit has no curriculum material, so the lab cannot be regenerated. Upload and group material into units first, then try again.',
        reviewApproved: null,
        reviewFlags: null,
      };
    }

    try {
      if (isTemplate) {
        onStep?.('design_game');
        const spec = await this.runArchitect(
          buildLabArchitectPrompt({ topic: lab.topic, curriculum }),
        );
        await this.prisma.lab.update({
          where: { id: lab.id },
          data: {
            status: 'PENDING_TEACHER_REVIEW',
            template: spec.template,
            gameSpec: spec,
            reviewApproved: null,
            reviewFlags: Prisma.DbNull,
          },
          include: { offerings: true },
        });
        return {
          grounded: true,
          labId: lab.id,
          status: 'PENDING_TEACHER_REVIEW',
          message: null,
          reviewApproved: null,
          reviewFlags: null,
        };
      }

      onStep?.('generate_code');
      const { code } = await this.runGenerator(
        buildLabGenerationPrompt({ topic: lab.topic, curriculum }),
      );
      const guard = this.guardGeneratedCode(code);
      const status = guard
        ? ('AI_REVIEW_FAILED' as const)
        : ('PENDING_TEACHER_REVIEW' as const);
      await this.prisma.lab.update({
        where: { id: lab.id },
        data: {
          status,
          generatedCode: code,
          reviewApproved: guard ? false : null,
          reviewFlags: guard
            ? { flags: guard.flags, reasoning: guard.reasoning }
            : Prisma.DbNull,
        },
        include: { offerings: true },
      });
      this.logger.log(
        `[labs] lab ${lab.id} regenerated → ${guard ? 'guarded' : 'ok'} (single pass)`,
      );
      return {
        grounded: true,
        labId: lab.id,
        status,
        message: null,
        reviewApproved: guard ? false : null,
        reviewFlags: guard
          ? { flags: guard.flags, reasoning: guard.reasoning }
          : null,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.prisma.lab.update({
        where: { id: lab.id },
        data: {
          status: 'AI_REVIEW_FAILED',
          reviewApproved: false,
          reviewFlags: {
            flags: ['The AI generation pipeline failed.'],
            reasoning: reason,
          },
        },
        include: { offerings: true },
      });
      this.logger.error(
        `[labs] regeneration pipeline failed for ${lab.id}: ${reason}`,
      );
      return {
        grounded: true,
        labId: lab.id,
        status: 'AI_REVIEW_FAILED',
        message:
          'The AI generation pipeline failed. See the review flags for details.',
        reviewApproved: false,
        reviewFlags: {
          flags: ['The AI generation pipeline failed.'],
          reasoning: reason,
        },
      };
    }
  }

  /** Hard-delete a lab the teacher owns, any status. Removes student access. */
  async delete(user: User, labId: string): Promise<LabDto> {
    const lab = await this.findOwned(user, labId);
    await this.prisma.lab.delete({ where: { id: lab.id } });
    this.logger.log(`[labs] lab ${lab.id} deleted by ${user.id}`);
    return this.toDto(lab);
  }

  /**
   * Hard-delete multiple labs the teacher owns, any status. Every id must
   * resolve to a lab the teacher owns — a single missing or foreign id fails
   * the whole request so the frontend's selection and reality can never
   * silently diverge.
   */
  async deleteMany(user: User, labIds: string[]): Promise<{ deleted: number }> {
    const uniqueIds = [...new Set(labIds)];
    const owned = await this.prisma.lab.findMany({
      where: {
        id: { in: uniqueIds },
        organizationId: user.organizationId ?? undefined,
        createdBy: user.id,
      },
      select: { id: true },
    });
    if (owned.length !== uniqueIds.length) {
      throw new ApiError(
        ErrorCode.LAB_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'One or more labs could not be found.',
      );
    }
    const result = await this.prisma.lab.deleteMany({
      where: { id: { in: uniqueIds } },
    });
    this.logger.log(`[labs] ${result.count} labs deleted by ${user.id}`);
    return { deleted: result.count };
  }

  /**
   * Role-aware list. Students only ever see PUBLISHED labs in offerings they
   * are enrolled in — enforced here, server-side, not by the frontend.
   */
  async listForUser(user: User, courseOfferingId?: string): Promise<LabDto[]> {
    if (user.role === 'STUDENT') {
      const labs = await this.prisma.lab.findMany({
        where: {
          organizationId: user.organizationId ?? undefined,
          status: 'PUBLISHED',
          offerings: {
            some: {
              ...(courseOfferingId ? { courseOfferingId } : {}),
              courseOffering: {
                section: {
                  enrollments: {
                    some: { studentId: user.id, status: 'APPROVED' },
                  },
                },
              },
            },
          },
        },
        include: { offerings: true },
        orderBy: { publishedAt: 'desc' },
      });
      return labs.map((lab) => this.toDto(lab));
    }
    const labs = await this.prisma.lab.findMany({
      where: {
        organizationId: user.organizationId ?? undefined,
        createdBy: user.id,
        ...(courseOfferingId
          ? { offerings: { some: { courseOfferingId } } }
          : {}),
      },
      include: { offerings: true },
      orderBy: { createdAt: 'desc' },
    });
    return labs.map((lab) => this.toDto(lab));
  }

  /**
   * Role-aware single lab. Students can only ever retrieve PUBLISHED labs —
   * a direct URL to a pending/rejected lab returns 404, never the content.
   */
  async getForUser(user: User, labId: string): Promise<LabDto> {
    const lab = await this.prisma.lab.findFirst({
      where: { id: labId, organizationId: user.organizationId ?? undefined },
      include: { offerings: true },
    });
    if (!lab) {
      throw new ApiError(
        ErrorCode.LAB_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This lab could not be found.',
      );
    }
    if (user.role === 'STUDENT' && lab.status !== 'PUBLISHED') {
      throw new ApiError(
        ErrorCode.LAB_NOT_PUBLISHED,
        HttpStatus.NOT_FOUND,
        'This lab is not available.',
      );
    }
    if (user.role !== 'STUDENT' && lab.createdBy !== user.id) {
      throw new ApiError(
        ErrorCode.LAB_FORBIDDEN,
        HttpStatus.NOT_FOUND,
        'This lab could not be found.',
      );
    }
    return this.toDto(lab);
  }

  // ─── Internals ────────────────────────────────────────

  private buildCurriculum(
    chunks: {
      content: string;
      materialTitle: string;
      chapterTitle: string | null;
      distance: number;
    }[],
  ): string {
    return chunks
      .map(
        (c, idx) =>
          `[Result ${idx + 1}] (from: ${c.materialTitle}${
            c.chapterTitle ? `, chapter: ${c.chapterTitle}` : ''
          }, relevance: ${c.distance.toFixed(4)})\n${c.content}`,
      )
      .join('\n\n');
  }

  private async findOwned(
    user: User,
    labId: string,
  ): Promise<LabWithOfferings> {
    const lab = await this.prisma.lab.findFirst({
      where: {
        id: labId,
        organizationId: user.organizationId ?? undefined,
        createdBy: user.id,
      },
      include: { offerings: true },
    });
    if (!lab) {
      throw new ApiError(
        ErrorCode.LAB_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This lab could not be found.',
      );
    }
    return lab;
  }

  /**
   * Re-ground a stored lab in its unit's material. Returns '' when the unit
   * has no material (callers treat that as "not grounded").
   */
  private async loadCurriculum(lab: {
    courseOfferingId: string;
    chapterId: string | null;
    topic: string;
  }): Promise<string> {
    const offering = await this.prisma.courseOffering.findFirst({
      where: { id: lab.courseOfferingId },
      select: { courseId: true },
    });
    if (offering?.courseId && lab.chapterId) {
      const chunks = await this.materials.getChunksByChapter(
        offering.courseId,
        lab.chapterId,
        LabsService.CHAPTER_CHUNK_LIMIT,
      );
      return this.buildCurriculum(chunks);
    }
    const chunks = await this.materials.searchChunks(
      lab.courseOfferingId,
      lab.topic,
      LabsService.GROUNDING_TOP_K,
    );
    return this.buildCurriculum(chunks);
  }

  /** One structured run of the architect agent with a bounded retry. */
  private async runArchitect(prompt: string): Promise<LabGameSpec> {
    return this.runAgent(
      'architect',
      () =>
        this.architect.generate(prompt, {
          structuredOutput: { schema: LabGameSpecSchema },
        }),
      (value) => LabGameSpecSchema.parse(value),
    );
  }

  /** One structured run of the generator agent with a bounded retry. */
  private async runGenerator(prompt: string): Promise<LabGeneratorOutput> {
    return this.runAgent(
      'generator',
      () =>
        this.generator.generate(prompt, {
          structuredOutput: { schema: LabGeneratorOutputSchema },
        }),
      (value) => LabGeneratorOutputSchema.parse(value),
    );
  }

  /**
   * Deterministic plain-code guard replacing the LLM reviewer. The sandbox
   * (CSP + opaque origin) already blocks network, storage, eval and parent
   * access, and the teacher reviews functionality manually — so the only
   * things worth failing on here are an empty output and a missing render
   * target. Pure string checks, never a prompt judgment.
   */
  private guardGeneratedCode(
    code: string,
  ): { flags: string[]; reasoning: string } | null {
    if (!code || code.trim().length === 0) {
      return {
        flags: ['The generator returned empty code.'],
        reasoning: 'No code was produced, so the sandbox has nothing to run.',
      };
    }
    if (!code.includes("getElementById('sim')")) {
      return {
        flags: ['The generated code never renders into #sim.'],
        reasoning:
          'The simulation never attaches a render target to the sandbox container, so students would see a blank screen.',
      };
    }
    return null;
  }

  private async runAgent<T>(
    label: string,
    invoke: () => Promise<{ object?: unknown }>,
    parse: (value: unknown) => T,
  ): Promise<T> {
    let lastParseError: unknown;
    for (let attempt = 0; attempt < LabsService.AGENT_ATTEMPTS; attempt++) {
      let result: { object?: unknown };
      try {
        result = await invoke();
      } catch (error) {
        // Provider / network / timeout failures are NOT retried — a timed-out
        // call won't be fixed by retrying it, it only triples the wait. Only
        // structured-output validation failures get the bounded retry below.
        this.logger.warn(
          `[labs] ${label} provider call failed: ${(error as Error).message}`,
        );
        throw error;
      }
      try {
        return parse(result.object);
      } catch (error) {
        lastParseError = error;
        this.logger.warn(
          `[labs] ${label} attempt ${attempt + 1} output invalid: ${(error as Error).message}`,
        );
      }
    }
    throw lastParseError;
  }

  /** Free-form interactive game generation, single pass with deterministic guards. */
  private async runLegacyGeneration(
    lab: LabWithOfferings,
    curriculum: string,
    topic: string,
    onStep?: (step: LabAgentStep) => void,
  ): Promise<GenerateLabResponseDto> {
    onStep?.('generate_code');
    const { code } = await this.runGenerator(
      buildLabGenerationPrompt({ topic, curriculum }),
    );
    const guard = this.guardGeneratedCode(code);
    const status = guard
      ? ('AI_REVIEW_FAILED' as const)
      : ('PENDING_TEACHER_REVIEW' as const);

    await this.prisma.lab.update({
      where: { id: lab.id },
      data: {
        status,
        template: null,
        generatedCode: code,
        reviewApproved: guard ? false : null,
        reviewFlags: guard
          ? { flags: guard.flags, reasoning: guard.reasoning }
          : Prisma.DbNull,
      },
      include: { offerings: true },
    });
    this.logger.log(
      `[labs] lab ${lab.id} generated → ${guard ? 'guarded' : 'ok'} (single pass)`,
    );

    return {
      grounded: true,
      labId: lab.id,
      status,
      message: null,
      reviewApproved: guard ? false : null,
      reviewFlags: guard
        ? { flags: guard.flags, reasoning: guard.reasoning }
        : null,
    };
  }

  private toDto(lab: LabWithOfferings): LabDto {
    const reviewFlags = lab.reviewFlags as {
      flags: string[];
      reasoning: string;
    } | null;
    return {
      id: lab.id,
      courseOfferingId: lab.courseOfferingId,
      courseOfferingIds: lab.offerings.map((o) => o.courseOfferingId),
      topic: lab.topic,
      chapterId: lab.chapterId,
      status: lab.status,
      template: lab.template,
      gameSpec: lab.gameSpec,
      generatedCode: lab.generatedCode,
      reviewApproved: lab.reviewApproved,
      reviewFlags:
        reviewFlags && Array.isArray(reviewFlags.flags) ? reviewFlags : null,
      teacherNotes: lab.teacherNotes,
      publishedAt: lab.publishedAt?.toISOString() ?? null,
      createdAt: lab.createdAt.toISOString(),
    };
  }
}
