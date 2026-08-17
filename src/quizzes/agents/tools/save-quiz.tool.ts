import { z } from 'zod';
import { PrismaService } from '../../../prisma/prisma.service';

const SaveQuestionSchema = z.object({
  type: z.enum(['MCQ', 'TRUE_FALSE', 'SHORT_ANSWER', 'ESSAY']),
  question: z.string().min(1),
  options: z
    .array(
      z.object({ text: z.string(), isCorrect: z.boolean().default(false) }),
    )
    .nullish(),
  points: z.number().int().min(1).nullish(),
  order: z.number().int().min(0).nullish(),
  correctAnswer: z.string().nullish(),
});

const SaveAssignmentSchema = z.object({
  courseOfferingId: z.string().uuid(),
  targetStudentIds: z.array(z.string().uuid()).optional(),
});

export const SaveQuizInputSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  teacherId: z.string().uuid(),
  assignments: z.array(SaveAssignmentSchema).min(1),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).optional(),
  timeLimit: z.number().int().min(1),
  endsAt: z.string().datetime(),
  questions: z.array(SaveQuestionSchema).min(1),
});

export const SaveQuizOutputSchema = z.object({
  quizId: z.string(),
  title: z.string(),
  questionCount: z.number(),
});

export type SaveQuizInput = z.infer<typeof SaveQuizInputSchema>;

export function createSaveQuizTool(prisma: PrismaService) {
  return {
    inputSchema: SaveQuizInputSchema,
    outputSchema: SaveQuizOutputSchema,
    execute: async (
      input: SaveQuizInput,
    ): Promise<z.infer<typeof SaveQuizOutputSchema>> => {
      const quiz = await prisma.quiz.create({
        data: {
          title: input.title,
          description: input.description ?? null,
          teacherId: input.teacherId,
          status: 'DRAFT',
          difficulty: input.difficulty ?? 'MEDIUM',
          source: 'AI',
          timeLimit: input.timeLimit,
          endsAt: new Date(input.endsAt),
          assignments: {
            create: input.assignments.map((a) => ({
              courseOfferingId: a.courseOfferingId,
              targetStudentIds: a.targetStudentIds ?? [],
            })),
          },
          questions: {
            create: input.questions.map((q) => ({
              type: q.type,
              question: q.question,
              options: q.options ?? undefined,
              points: q.points ?? 1,
              order: q.order ?? 0,
            })),
          },
        },
      });

      return {
        quizId: quiz.id,
        title: quiz.title,
        questionCount: input.questions.length,
      };
    },
  };
}
