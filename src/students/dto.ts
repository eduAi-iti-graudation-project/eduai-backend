import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const GradeSchema = z.object({
  id: z.string().uuid(),
  submissionId: z.string().uuid(),
  criteriaId: z.string().uuid(),
  pointsAwarded: z.number(),
  teacherNotes: z.string().nullable(),
  createdAt: z.string(),
});

export class GradeDto extends createZodDto(GradeSchema) {}
