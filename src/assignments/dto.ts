import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateAssignmentSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  dueDate: z.string().datetime(),
  totalPoints: z.number().int().positive(),
  classId: z.string().uuid(),
});

export const UpdateAssignmentSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  dueDate: z.string().datetime().optional(),
  totalPoints: z.number().int().positive().optional(),
});

const AssignmentSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  dueDate: z.string(),
  totalPoints: z.number(),
  classId: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export class CreateAssignmentDto extends createZodDto(CreateAssignmentSchema) {}
export class UpdateAssignmentDto extends createZodDto(UpdateAssignmentSchema) {}
export class AssignmentDto extends createZodDto(AssignmentSchema) {}
