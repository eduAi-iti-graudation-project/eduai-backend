import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const GradeSchema = z.object({
  id: z.string().uuid(),
  submissionId: z.string().uuid(),
  assignmentId: z.string().uuid(),
  criteriaId: z.string().uuid(),
  pointsAwarded: z.number(),
  aiFeedback: z.string().nullable(),
  teacherNotes: z.string().nullable(),
  isConfirmed: z.boolean(),
  createdAt: z.string(),
  criterionDescription: z.string(),
  criterionMaxPoints: z.number(),
});

export const UpdateStudentSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  gradeId: z.string().uuid().optional(),
  guardianId: z.string().uuid().optional(),
});

export class GradeDto extends createZodDto(GradeSchema) {}
export class UpdateStudentDto extends createZodDto(UpdateStudentSchema) {}
