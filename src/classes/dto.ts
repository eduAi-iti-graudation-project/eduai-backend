import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateClassSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  teacherId: z.string().uuid(),
});

export const UpdateClassSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
});

export const AddEnrollmentSchema = z.object({
  studentId: z.string().uuid(),
});

const ClassSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  teacherId: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export class CreateClassDto extends createZodDto(CreateClassSchema) {}
export class UpdateClassDto extends createZodDto(UpdateClassSchema) {}
export class AddEnrollmentDto extends createZodDto(AddEnrollmentSchema) {}
export class ClassDto extends createZodDto(ClassSchema) {}
