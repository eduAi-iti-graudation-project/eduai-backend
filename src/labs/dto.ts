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
  courseOfferingId: z
    .string()
    .uuid()
    .describe('The course offering the lab belongs to.'),
  topic: z
    .string()
    .min(1)
    .max(200)
    .describe('The topic the simulation should be grounded in.'),
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

// ─── Responses ──────────────────────────────────────────
const ReviewFlagsSchema = z.object({
  flags: z.array(z.string()),
  reasoning: z.string(),
});

const LabSchema = z.object({
  id: z.string().uuid(),
  courseOfferingId: z.string().uuid(),
  topic: z.string(),
  status: LabStatusSchema,
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
 * material matched the topic and neither agent was invoked. When grounded,
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
