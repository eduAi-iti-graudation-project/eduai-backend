import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const GradingOutputSchema = z.object({
  scores: z
    .array(
      z.object({
        criterionId: z.string().uuid(),
        pointsAwarded: z.number().int().min(0),
        feedback: z.string().min(1),
      }),
    )
    .min(1),
  overallFeedback: z.string().optional(),
});

export const UpdateScoreSchema = z.object({
  pointsAwarded: z.number().int().min(0),
});

export class UpdateScoreDto extends createZodDto(UpdateScoreSchema) {}
