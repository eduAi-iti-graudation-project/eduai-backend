import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// ─── Status enum shared with Prisma ─────────────────────
export const LabStatusSchema = z.enum([
  'GENERATING',
  'AI_REVIEW_FAILED',
  'PENDING_TEACHER_REVIEW',
  'PUBLISHED',
  'REJECTED',
]);

// ─── Requests ───────────────────────────────────────────
const GenerateLabSchema = z.object({
  courseOfferingIds: z
    .array(z.string().uuid())
    .min(1)
    .max(30)
    .describe(
      'The course offerings (sections) the lab should apply to. All must belong to the same course; the first is the primary used to ground the prompt in curriculum material.',
    ),
  chapterId: z
    .string()
    .uuid()
    .describe(
      'The material unit (chapter) of the selected course the lab is grounded in and generated from.',
    ),
  prompt: z
    .string()
    .min(3)
    .max(2000)
    .describe(
      'The teacher’s prompt describing the lab to generate for the selected unit. Also stored as the lab topic.',
    ),
  mode: z
    .enum(['template', 'advanced'])
    .optional()
    .describe(
      "'template' (default) generates a reliable interactive game from a fixed template via the lab architect agent. 'advanced' runs free-form generation of any self-contained interactive game code, checked by deterministic plain-code guards, then runs in the sandbox.",
    ),
});
export class GenerateLabDto extends createZodDto(GenerateLabSchema) {}

const RejectLabSchema = z.object({
  notes: z
    .string()
    .max(2000)
    .optional()
    .describe('Optional teacher notes explaining the rejection.'),
});
export class RejectLabDto extends createZodDto(RejectLabSchema) {}

const RefineLabSchema = z.object({
  instruction: z
    .string()
    .min(3)
    .max(2000)
    .describe(
      'The teacher’s requested modification. The AI modifies the existing generated code in place — it never regenerates from scratch.',
    ),
});
export class RefineLabDto extends createZodDto(RefineLabSchema) {}

const BulkDeleteLabsSchema = z.object({
  ids: z
    .array(z.string().uuid())
    .min(1)
    .max(50)
    .describe(
      'The labs to hard-delete. All must be owned by the requesting teacher — a single non-owned or missing id fails the whole request.',
    ),
});
export class BulkDeleteLabsDto extends createZodDto(BulkDeleteLabsSchema) {}

// ─── Responses ──────────────────────────────────────────
const ReviewFlagsSchema = z.object({
  flags: z.array(z.string()),
  reasoning: z.string(),
});

const LabSchema = z.object({
  id: z.string().uuid(),
  courseOfferingId: z.string().uuid(),
  courseOfferingIds: z.array(z.string().uuid()),
  topic: z.string(),
  chapterId: z.string().uuid().nullable(),
  status: LabStatusSchema,
  template: z.string().nullable(),
  gameSpec: z.unknown().nullable(),
  generatedCode: z.string().nullable(),
  reviewApproved: z.boolean().nullable(),
  reviewFlags: ReviewFlagsSchema.nullable(),
  teacherNotes: z.string().nullable(),
  publishedAt: z.string().nullable(),
  createdAt: z.string(),
});
export class LabDto extends createZodDto(LabSchema) {}

/**
 * POST /labs/generate response. `grounded: false` means no curriculum
 * material matched the unit and neither agent was invoked. When grounded,
 * `labId` points at the created lab whose status is either
 * PENDING_TEACHER_REVIEW (approved) or AI_REVIEW_FAILED (with flags).
 */
const GenerateLabResponseSchema = z.object({
  grounded: z.boolean(),
  labId: z.string().uuid().nullable(),
  status: LabStatusSchema.nullable(),
  message: z.string().nullable(),
  reviewApproved: z.boolean().nullable(),
  reviewFlags: ReviewFlagsSchema.nullable(),
});
export class GenerateLabResponseDto extends createZodDto(
  GenerateLabResponseSchema,
) {}

// ─── AI pipeline events (SSE) ───────────────────────────
export type LabAgentStep =
  | 'thinking'
  | 'search_curriculum'
  | 'generate_code'
  | 'design_game'
  | 'load_lab'
  | 'modify_lab';

export type LabGenerationEvent =
  | { type: 'step'; step: LabAgentStep }
  | { type: 'done'; data: GenerateLabResponseDto }
  | { type: 'error'; message: string };
