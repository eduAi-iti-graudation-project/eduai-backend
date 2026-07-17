import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ConfirmGradeSchema = z.object({
  pointsAwarded: z.number().int().min(0),
  teacherNotes: z.string().optional(),
});

export class ConfirmGradeDto extends createZodDto(ConfirmGradeSchema) {}

const CriterionScoreSchema = z.object({
  criterionId: z.string().uuid(),
  pointsAwarded: z.number().int().min(0),
  feedback: z.string().min(1),
});

export const GradingOutputSchema = z.object({
  scores: z.array(CriterionScoreSchema).min(1),
  overallFeedback: z.string().optional(),
});

export type GradingOutput = z.infer<typeof GradingOutputSchema>;
