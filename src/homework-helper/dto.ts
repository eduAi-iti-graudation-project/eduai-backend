import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const HomeworkHelpRequestSchema = z.object({
  courseOfferingId: z.string().uuid(),
  question: z.string().min(1),
  assignmentId: z.string().uuid().optional(),
});

export const HomeworkHelpResponseSchema = z.object({
  answer: z.string(),
  reply: z.string(),
  action: z.enum(['HINT', 'EXPLANATION', 'REDIRECT_TEACHER']),
  sources: z.array(z.string()),
  interactionId: z.string().uuid(),
  teacherNotified: z.boolean(),
  threadId: z.string().uuid().optional(),
});

export const HomeworkToolSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('search_curriculum'),
    query: z.string(),
    topK: z.number().int().min(1).max(20).optional(),
  }),
  z.object({
    action: z.literal('lookup_assignment'),
    query: z.string(),
  }),
  z.object({
    action: z.literal('search_web'),
    query: z.string(),
    maxResults: z.number().int().min(1).max(10).optional(),
  }),
  z.object({
    action: z.literal('respond_to_student'),
    answer: z.string(),
    responseAction: z.enum(['HINT', 'EXPLANATION', 'REDIRECT_TEACHER']),
    sources: z.array(z.string()),
  }),
]);

const InteractionHistorySchema = z.object({
  id: z.string().uuid(),
  question: z.string(),
  answer: z.string(),
  action: z.enum(['HINT', 'EXPLANATION', 'REDIRECT_TEACHER']),
  sources: z.array(z.string()),
  feedback: z.string().nullable(),
  createdAt: z.string(),
});

export const HomeworkHelpHistoryResponseSchema = z.object({
  interactions: z.array(InteractionHistorySchema),
});

export const HomeworkHelpFeedbackSchema = z.object({
  feedback: z.enum(['HELPFUL', 'NOT_HELPFUL']),
});

export type HomeworkToolCall = z.infer<typeof HomeworkToolSchema>;

export type HomeworkAgentStep =
  | 'search_material'
  | 'search_assignment'
  | 'search_web'
  | 'thinking'
  | 'teacher';

export type HomeworkHelpEvent =
  | { type: 'step'; step: HomeworkAgentStep }
  | { type: 'done'; data: HomeworkHelpResponseDto }
  | { type: 'error'; message: string };

export class HomeworkHelpRequestDto extends createZodDto(
  HomeworkHelpRequestSchema,
) {}
export class HomeworkHelpResponseDto extends createZodDto(
  HomeworkHelpResponseSchema,
) {}
export class HomeworkHelpHistoryResponseDto extends createZodDto(
  HomeworkHelpHistoryResponseSchema,
) {}
export class HomeworkHelpFeedbackDto extends createZodDto(
  HomeworkHelpFeedbackSchema,
) {}
