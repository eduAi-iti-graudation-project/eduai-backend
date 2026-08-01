import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';

export const LogInteractionInputSchema = z.object({
  studentId: z.string().uuid(),
  classId: z.string().uuid(),
  question: z.string(),
  answer: z.string(),
  action: z.enum(['HINT', 'EXPLANATION', 'REDIRECT_TEACHER']),
  sources: z.array(z.string()),
});

export const LogInteractionOutputSchema = z.object({
  interactionId: z.string().uuid(),
});

export type LogInteractionInput = z.infer<typeof LogInteractionInputSchema>;

export function createLogInteractionTool(prisma: PrismaService) {
  return {
    inputSchema: LogInteractionInputSchema,
    outputSchema: LogInteractionOutputSchema,
    execute: async (
      input: LogInteractionInput,
    ): Promise<z.infer<typeof LogInteractionOutputSchema>> => {
      const interaction = await prisma.homeworkHelpInteraction.create({
        data: {
          studentId: input.studentId,
          classId: input.classId,
          question: input.question,
          answer: input.answer,
          action: input.action,
          sources: input.sources,
        },
      });

      return { interactionId: interaction.id };
    },
  };
}
