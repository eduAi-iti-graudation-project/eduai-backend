import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateGradeSchema = z.object({
  level: z.number().int().min(1).max(12),
  name: z.string().min(1),
});

export const AddGradeClassSchema = z.object({
  classId: z.string().uuid(),
});

const GradeSchema = z.object({
  id: z.string().uuid(),
  level: z.number().int(),
  name: z.string(),
  createdAt: z.string(),
});

const GradeClassSchema = z.object({
  id: z.string().uuid(),
  gradeId: z.string().uuid(),
  classId: z.string().uuid(),
});

export class CreateGradeDto extends createZodDto(CreateGradeSchema) {}
export class AddGradeClassDto extends createZodDto(AddGradeClassSchema) {}
export class GradeDto extends createZodDto(GradeSchema) {}
export class GradeClassDto extends createZodDto(GradeClassSchema) {}
