import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// ─── Responses ──────────────────────────────────────────
const StruggleSignalSchema = z.object({
  id: z.string().uuid(),
  studentId: z.string().uuid(),
  studentName: z.string().nullable(),
  concept: z.string(),
  explanation: z.string(),
  status: z.enum(['PENDING', 'SENT', 'DISMISSED']),
  classWide: z.boolean(),
  quizId: z.string().uuid().nullable(),
  interactionId: z.string().uuid().nullable(),
  createdAt: z.string(),
});

const ClassWideClusterSchema = z.object({
  concept: z.string(),
  studentCount: z.number(),
  signals: z.array(StruggleSignalSchema),
});

const StruggleSignalsResponseSchema = z.object({
  pending: z.object({
    classWide: z.array(ClassWideClusterSchema),
    individual: z.array(StruggleSignalSchema),
  }),
  history: z.array(StruggleSignalSchema),
});

const SendSignalResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['SENT']),
  quizId: z.string().uuid(),
});

const DismissSignalResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['DISMISSED']),
});

// ─── DTO Classes ────────────────────────────────────────
export class StruggleSignalsResponseDto extends createZodDto(
  StruggleSignalsResponseSchema,
) {}
export class SendSignalResponseDto extends createZodDto(
  SendSignalResponseSchema,
) {}
export class DismissSignalResponseDto extends createZodDto(
  DismissSignalResponseSchema,
) {}
