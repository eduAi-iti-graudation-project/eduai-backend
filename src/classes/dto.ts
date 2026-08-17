import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const AssignClassTeacherSchema = z.object({
  teacherId: z.string().uuid(),
});

const ClassSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  gradeLevelId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  teacherId: z.string().uuid().nullish(),
  courses: z.array(z.string()).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export class AssignClassTeacherDto extends createZodDto(
  AssignClassTeacherSchema,
) {}
export class ClassDto extends createZodDto(ClassSchema) {}
