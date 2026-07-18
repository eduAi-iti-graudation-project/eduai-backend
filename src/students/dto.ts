import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const GradeSchema = z.object({
  id: z.string().uuid(),
  submissionId: z.string().uuid(),
  criteriaId: z.string().uuid(),
  pointsAwarded: z.number(),
  aiFeedback: z.string().nullable(),
  teacherNotes: z.string().nullable(),
  isConfirmed: z.boolean(),
  createdAt: z.string(),
});

export class GradeDto extends createZodDto(GradeSchema) {}
