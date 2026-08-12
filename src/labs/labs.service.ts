import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { Lab, User } from '@prisma/client';
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
  buildLabReviewPrompt,
  createLabReviewer,
  LabReviewerOutputSchema,
  type LabReviewer,
  type LabReviewerOutput,
} from './agents/lab-reviewer.agent';
import type { GenerateLabDto, GenerateLabResponseDto, LabDto } from './dto';

const PENDING_LAB_STATUSES = [
  'GENERATING',
  'AI_REVIEW_FAILED',
  'PENDING_TEACHER_REVIEW',
] as const;

/**
 * AI-generated science lab simulations.
 *
 * Layered defense, always in this order and none replace another:
 *  1. Generator agent — Matter.js-only code grounded in curriculum material.
 *  2. Reviewer agent — a SEPARATE agent that adversarially inspects the
 *     generator's raw output for forbidden APIs / obfuscation.
 *  3. Teacher review — the teacher plays the simulation before publishing.
 *  4. Sandboxed iframe + strict CSP — the always-on execution layer, applied
 *     in the frontend regardless of how clean layers 1–3 looked.
 * This service owns layers 1–2 and the Lab lifecycle; layer 4 lives in the
 * frontend's shared LabSimulationFrame component.
 */
@Injectable()
export class LabsService {
  private readonly logger = new Logger(LabsService.name);

  /** Top-k curriculum chunks fed to the generator. */
  private static readonly GROUNDING_TOP_K = 8;
  /** Agent output retries before giving up (mirrors the validate-with-retry pattern). */
  private static readonly AGENT_ATTEMPTS = 3;

  private readonly generator: LabGenerator;
  private readonly reviewer: LabReviewer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly materials: MaterialsService,
  ) {
    this.generator = createLabGenerator((systemPrompt, userPrompt) =>
      this.llm.chat(systemPrompt, userPrompt),
    );
    this.reviewer = createLabReviewer((systemPrompt, userPrompt) =>
      this.llm.chat(systemPrompt, userPrompt),
    );
  }

  /**
   * Grounds the topic in curriculum material, then runs the generator agent
   * and IMMEDIATELY the reviewer agent on its raw output before anything is
   * returned. A topic with no matching curriculum material is a "not
   * grounded" result — neither agent is invoked and no lab row is created.
   */
  async generate(
    user: User,
    dto: GenerateLabDto,
  ): Promise<GenerateLabResponseDto> {
    const offering = await this.prisma.courseOffering.findFirst({
      where: { id: dto.courseOfferingId, organizationId: user.organizationId },
    });
    if (!offering) {
      throw new ApiError(
        ErrorCode.LAB_FORBIDDEN,
        HttpStatus.NOT_FOUND,
        'This course offering could not be found.',
      );
    }

    // Layer 1a: grounding (deterministic retrieval — the same curriculum RAG
    // the Assistant / Homework Helper use).
    const chunks = await this.materials.searchChunks(
      dto.courseOfferingId,
      dto.topic,
      LabsService.GROUNDING_TOP_K,
    );
    if (chunks.length === 0) {
      this.logger.log(
        `[labs] topic "${dto.topic}" not grounded for offering ${dto.courseOfferingId}`,
      );
      return {
        grounded: false,
        labId: null,
        status: null,
        message: `No curriculum material was found for "${dto.topic}" in this class, so a lab simulation can't be generated on this topic. Upload material covering it first, then try again.`,
        reviewApproved: null,
        reviewFlags: null,
      };
    }

    const lab = await this.prisma.lab.create({
      data: {
        organizationId: user.organizationId,
        courseOfferingId: dto.courseOfferingId,
        createdBy: user.id,
        topic: dto.topic,
        status: 'GENERATING',
      },
    });

    const curriculum = chunks
      .map(
        (c, idx) =>
          `[Result ${idx + 1}] (from: ${c.materialTitle}${
            c.chapterTitle ? `, chapter: ${c.chapterTitle}` : ''
          }, relevance: ${c.distance.toFixed(4)})\n${c.content}`,
      )
      .join('\n\n');

    try {
      // Layer 1b: the generator agent.
      const generated = await this.runGenerator(
        buildLabGenerationPrompt({ topic: dto.topic, curriculum }),
      );
      // Layer 2: the reviewer agent — immediately, on the raw code, separate
      // agent instance, never grading its own output.
      const review = await this.runReviewer(generated.code);
      // Deterministic guard: even one flag means not approved, regardless of
      // what the reviewer claims. Plain code, never a prompt judgment.
      const approved = review.approved && review.flags.length === 0;
      const status = approved
        ? ('PENDING_TEACHER_REVIEW' as const)
        : ('AI_REVIEW_FAILED' as const);

      await this.prisma.lab.update({
        where: { id: lab.id },
        data: {
          status,
          generatedCode: generated.code,
          reviewApproved: approved,
          reviewFlags: { flags: review.flags, reasoning: review.reasoning },
        },
      });
      this.logger.log(
        `[labs] lab ${lab.id} review ${approved ? 'approved' : 'rejected'} (${review.flags.length} flags)`,
      );

      return {
        grounded: true,
        labId: lab.id,
        status,
        message: null,
        reviewApproved: approved,
        reviewFlags: { flags: review.flags, reasoning: review.reasoning },
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
            flags: ['The AI generation or review pipeline failed.'],
            reasoning: reason,
          },
        },
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
          flags: ['The AI generation or review pipeline failed.'],
          reasoning: reason,
        },
      };
    }
  }

  /** Teacher publish — only from PENDING_TEACHER_REVIEW. */
  async publish(user: User, labId: string): Promise<LabDto> {
    const lab = await this.findOwned(user, labId);
    if (lab.status !== 'PENDING_TEACHER_REVIEW') {
      throw new ApiError(
        ErrorCode.LAB_NOT_PUBLISHABLE,
        HttpStatus.BAD_REQUEST,
        'Only labs pending teacher review can be published.',
      );
    }
    const updated = await this.prisma.lab.update({
      where: { id: lab.id },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
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
    });
    return this.toDto(updated);
  }

  /**
   * Role-aware list. Students only ever see PUBLISHED labs in offerings they
   * are enrolled in — enforced here, server-side, not by the frontend.
   */
  async listForUser(user: User, courseOfferingId?: string): Promise<LabDto[]> {
    if (user.role === 'STUDENT') {
      const labs = await this.prisma.lab.findMany({
        where: {
          organizationId: user.organizationId,
          status: 'PUBLISHED',
          ...(courseOfferingId ? { courseOfferingId } : {}),
          courseOffering: {
            section: {
              enrollments: { some: { studentId: user.id, status: 'APPROVED' } },
            },
          },
        },
        orderBy: { publishedAt: 'desc' },
      });
      return labs.map((lab) => this.toDto(lab));
    }
    const labs = await this.prisma.lab.findMany({
      where: {
        organizationId: user.organizationId,
        createdBy: user.id,
        ...(courseOfferingId ? { courseOfferingId } : {}),
      },
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
      where: { id: labId, organizationId: user.organizationId },
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

  private async findOwned(user: User, labId: string): Promise<Lab> {
    const lab = await this.prisma.lab.findFirst({
      where: {
        id: labId,
        organizationId: user.organizationId,
        createdBy: user.id,
      },
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

  /** One structured run of the reviewer agent with a bounded retry. */
  private async runReviewer(code: string): Promise<LabReviewerOutput> {
    return this.runAgent(
      'reviewer',
      () =>
        this.reviewer.generate(buildLabReviewPrompt(code), {
          structuredOutput: { schema: LabReviewerOutputSchema },
        }),
      (value) => LabReviewerOutputSchema.parse(value),
    );
  }

  private async runAgent<T>(
    label: string,
    invoke: () => Promise<{ object?: unknown }>,
    parse: (value: unknown) => T,
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < LabsService.AGENT_ATTEMPTS; attempt++) {
      try {
        const result = await invoke();
        return parse(result.object);
      } catch (error) {
        lastError = error;
        this.logger.warn(
          `[labs] ${label} attempt ${attempt + 1} failed: ${(error as Error).message}`,
        );
      }
    }
    throw lastError;
  }

  private toDto(lab: Lab): LabDto {
    const reviewFlags = lab.reviewFlags as {
      flags: string[];
      reasoning: string;
    } | null;
    return {
      id: lab.id,
      courseOfferingId: lab.courseOfferingId,
      topic: lab.topic,
      status: lab.status,
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
