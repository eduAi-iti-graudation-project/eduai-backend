import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ConfirmGradeSchema = z.object({
  pointsAwarded: z.number().int().min(0),
  teacherNotes: z.string().optional(),
});

export class ConfirmGradeDto extends createZodDto(ConfirmGradeSchema) {}
