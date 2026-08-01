import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// ─── Enums ──────────────────────────────────────────────
export const QuestionTypeEnum = z.enum([
  'MCQ',
  'TRUE_FALSE',
  'SHORT_ANSWER',
  'ESSAY',
]);
export type QuestionType = z.infer<typeof QuestionTypeEnum>;

export const QuizStatusEnum = z.enum(['DRAFT', 'PUBLISHED', 'CLOSED']);

export const AttemptStatusEnum = z.enum(['IN_PROGRESS', 'COMPLETED']);

export const ViolationTypeEnum = z.enum(['TAB_SWITCH', 'FULLSCREEN_EXIT']);

// ─── Quiz CRUD ──────────────────────────────────────────
const QuizQuestionInputSchema = z.object({
  type: QuestionTypeEnum,
  question: z.string().min(1),
  options: z
    .array(
      z.object({
        text: z.string(),
        isCorrect: z.boolean().default(false),
      }),
    )
    .optional(),
  points: z.number().int().min(1).default(1),
  order: z.number().int().min(0),
});

export const CreateQuizSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  classId: z.string().uuid(),
  timeLimit: z.number().int().min(1).optional(),
  passingScore: z.number().int().min(0).optional(),
  questions: z.array(QuizQuestionInputSchema).min(1),
});

export const UpdateQuizSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  timeLimit: z.number().int().min(1).nullable().optional(),
  passingScore: z.number().int().min(0).nullable().optional(),
  status: QuizStatusEnum.optional(),
  questions: z.array(QuizQuestionInputSchema).optional(),
});

// ─── Quiz Generation Agent ──────────────────────────────
export const GenerateQuizSchema = z.object({
  classId: z.string().uuid(),
  topic: z.string().optional(),
  questionCount: z.number().int().min(1).max(30).default(5),
  types: z.array(QuestionTypeEnum).optional(),
});

export const QuizGenerationToolSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('search_curriculum'),
    query: z.string(),
    topK: z.number().int().min(1).max(20).nullish(),
  }),
  z.object({
    action: z.literal('generate_questions'),
    context: z.string(),
    types: z.array(QuestionTypeEnum).nullish(),
    count: z.number().int().min(1).max(20).default(5),
    topic: z.string().nullish(),
    avoidTopics: z.array(z.string()).nullish(),
  }),
  z.object({
    action: z.literal('review_questions'),
    questions: z.array(
      z.object({
        type: QuestionTypeEnum,
        question: z.string(),
        topic: z.string().nullish(),
      }),
    ),
    context: z.string(),
  }),
  z.object({
    action: z.literal('save_quiz'),
    title: z.string().min(1),
    description: z.string().nullish(),
    questions: z.array(
      z.object({
        type: QuestionTypeEnum,
        question: z.string(),
        options: z
          .array(
            z.object({
              text: z.string(),
              isCorrect: z.boolean().default(false),
            }),
          )
          .nullish(),
        points: z.number().int().min(1).nullish(),
        order: z.number().int().min(0).nullish(),
        correctAnswer: z.string().nullish(),
      }),
    ),
  }),
  z.object({
    action: z.literal('respond'),
    reply: z.string(),
  }),
]);

// ─── Attempts ────────────────────────────────────────────
export const StartAttemptSchema = z.object({
  quizId: z.string().uuid(),
});

export const SubmitAnswerSchema = z.object({
  questionId: z.string().uuid(),
  answer: z.string(),
});

export const SubmitAttemptSchema = z.object({
  answers: z.array(SubmitAnswerSchema).min(1),
});

export const ConfirmAttemptSchema = z.object({
  attemptId: z.string().uuid(),
});

export const ReportViolationSchema = z.object({
  type: ViolationTypeEnum,
});

export const UpdateAnswerSchema = z.object({
  pointsAwarded: z.number().int().min(0),
});

// ─── Response Schemas ───────────────────────────────────
const QuizQuestionResponseSchema = z.object({
  id: z.string(),
  type: QuestionTypeEnum,
  question: z.string(),
  options: z
    .array(z.object({ text: z.string(), isCorrect: z.boolean() }))
    .optional(),
  points: z.number(),
  order: z.number(),
});

export const QuizResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  classId: z.string(),
  teacherId: z.string(),
  timeLimit: z.number().nullable(),
  passingScore: z.number().nullable(),
  status: QuizStatusEnum,
  questions: z.array(QuizQuestionResponseSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const QuizListResponseSchema = z.object({
  quizzes: z.array(
    QuizResponseSchema.omit({ questions: true }).extend({
      questionCount: z.number(),
    }),
  ),
});

export const AttemptResponseSchema = z.object({
  id: z.string(),
  quizId: z.string(),
  studentId: z.string(),
  startedAt: z.string(),
  submittedAt: z.string().nullable(),
  totalScore: z.number().nullable(),
  status: AttemptStatusEnum,
  answers: z.array(
    z.object({
      id: z.string(),
      questionId: z.string(),
      answer: z.string(),
      pointsAwarded: z.number().nullable(),
      isConfirmed: z.boolean(),
      aiFeedback: z.string().nullable(),
      question: QuizQuestionResponseSchema.omit({ options: true }).optional(),
    }),
  ),
});

// ─── DTO Classes ────────────────────────────────────────
export class CreateQuizDto extends createZodDto(CreateQuizSchema) {}
export class UpdateQuizDto extends createZodDto(UpdateQuizSchema) {}
export class GenerateQuizDto extends createZodDto(GenerateQuizSchema) {}
export class SubmitAttemptDto extends createZodDto(SubmitAttemptSchema) {}
export class UpdateAnswerDto extends createZodDto(UpdateAnswerSchema) {}
export class ReportViolationDto extends createZodDto(ReportViolationSchema) {}
