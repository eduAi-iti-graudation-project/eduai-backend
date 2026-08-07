import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const MessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});

export const ChatSchema = z.object({
  courseOfferingId: z.string().uuid(),
  messages: z.array(MessageSchema),
  newMessage: z.string().min(1),
});

const QuizQuestionSchema = z.object({
  type: z.enum(['mcq', 'short_answer']),
  question: z.string().min(1),
  options: z.array(z.string()).length(4).optional(),
  correctAnswer: z.string().min(1),
  explanation: z.string().optional(),
});

export const QuizSchema = z.object({
  title: z.string().min(1),
  questions: z.array(QuizQuestionSchema).min(1).max(20),
});

export const RubricDraftSchema = z.object({
  title: z.string().min(1),
  criteria: z
    .array(
      z.object({
        description: z.string().min(1),
        maxPoints: z.number().int().min(1),
      }),
    )
    .min(1)
    .max(20),
});

export const LessonSummarySchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  keyPoints: z.array(z.string().min(1)).min(1),
});

export const LessonPlanSchema = z.object({
  title: z.string().min(1),
  objectives: z.array(z.string().min(1)).min(1).max(5),
  activities: z.array(z.string().min(1)).min(1).max(8),
  assessmentHint: z.string().min(1),
});

export const AssignmentDraftSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  instructions: z.string().min(1),
});

export const ClassAnalyticsSchema = z.object({
  overall: z.string().min(1),
  strugglingAreas: z.array(z.string().min(1)),
  recommendations: z.array(z.string().min(1)),
});

const SavedQuizSchema = z.object({
  quizId: z.string().uuid(),
  title: z.string(),
  questionCount: z.number().int(),
});

const ChatResponseSchema = z.object({
  reply: z.string(),
  quiz: QuizSchema.optional(),
  savedQuiz: SavedQuizSchema.optional(),
  rubric: RubricDraftSchema.optional(),
  lesson: z.union([LessonSummarySchema, LessonPlanSchema]).optional(),
  assignment: AssignmentDraftSchema.optional(),
  analytics: ClassAnalyticsSchema.optional(),
});

export const ToolCallSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('search_curriculum'),
    query: z.string(),
    topK: z.number().int().min(1).max(20).optional(),
  }),
  z.object({
    action: z.literal('create_quiz'),
    topic: z.string().min(1),
    questionCount: z.number().int().min(1).max(20).optional(),
    types: z.array(z.enum(['mcq', 'short_answer'])).optional(),
  }),
  z.object({
    action: z.literal('draft_rubric'),
    topic: z.string().min(1),
  }),
  z.object({
    action: z.literal('summarize_lesson'),
    topic: z.string().min(1),
  }),
  z.object({
    action: z.literal('plan_lesson'),
    topic: z.string().min(1),
  }),
  z.object({
    action: z.literal('class_analytics'),
    question: z.string().min(1),
  }),
  z.object({
    action: z.literal('draft_assignment'),
    topic: z.string().min(1),
  }),
  z.object({
    action: z.literal('respond'),
    reply: z.string(),
  }),
]);

export type Quiz = z.infer<typeof QuizSchema>;
export type RubricDraft = z.infer<typeof RubricDraftSchema>;
export type LessonSummary = z.infer<typeof LessonSummarySchema>;
export type LessonPlan = z.infer<typeof LessonPlanSchema>;
export type AssignmentDraft = z.infer<typeof AssignmentDraftSchema>;
export type ClassAnalytics = z.infer<typeof ClassAnalyticsSchema>;

export class ChatDto extends createZodDto(ChatSchema) {}
export class ChatResponseDto extends createZodDto(ChatResponseSchema) {}
