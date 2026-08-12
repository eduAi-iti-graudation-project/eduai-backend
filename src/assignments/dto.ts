import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateAssignmentSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  dueDate: z.string().datetime(),
  totalPoints: z.number().int().positive(),
  courseOfferingId: z.string().uuid(),
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
  courseOfferingId: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const GenerateAssignmentSchema = z.object({
  courseOfferingId: z.string().uuid(),
  topic: z.string().trim().min(3).max(2000),
  assignmentType: z.enum(['essay', 'short_answer', 'project']),
  targetPoints: z.number().int().positive().max(1000).optional(),
});

export const GeneratedCriterionSchema = z.object({
  description: z.string().min(1),
  maxPoints: z.number().int().positive(),
});

export const GeneratedAssignmentSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1),
  criteria: z.array(GeneratedCriterionSchema).min(1),
});

export const GenerateGroundedResultSchema = z.object({
  status: z.literal('grounded'),
  draft: GeneratedAssignmentSchema,
});

export const GenerateNotGroundedResultSchema = z.object({
  status: z.literal('not_grounded'),
  message: z.string(),
});

export const GenerateAssignmentResultSchema = z.discriminatedUnion('status', [
  GenerateGroundedResultSchema,
  GenerateNotGroundedResultSchema,
]);

export class CreateAssignmentDto extends createZodDto(CreateAssignmentSchema) {}
export class UpdateAssignmentDto extends createZodDto(UpdateAssignmentSchema) {}
export class AssignmentDto extends createZodDto(AssignmentSchema) {}
export class GenerateAssignmentDto extends createZodDto(
  GenerateAssignmentSchema,
) {}
export class GenerateGroundedResultDto extends createZodDto(
  GenerateGroundedResultSchema,
) {}
export class GenerateNotGroundedResultDto extends createZodDto(
  GenerateNotGroundedResultSchema,
) {}
