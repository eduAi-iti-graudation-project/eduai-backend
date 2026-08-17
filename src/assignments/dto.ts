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

// ─── Course-scoped AI generation (grade → course → multi-section) ──

export const AssignmentTargetSchema = z.object({
  courseOfferingId: z.string().uuid(),
});

export const GenerateCourseAssignmentSchema = z.object({
  courseId: z.string().uuid(),
  assignments: z.array(AssignmentTargetSchema).min(1),
  // The unit (material chapter) the assignment is generated from. When
  // omitted/null the assignment is generated from the ENTIRE course.
  chapterId: z.string().uuid().nullish(),
  dueDate: z.string().datetime(),
  assignmentType: z.enum(['essay', 'short_answer', 'project']).optional(),
});

export const GeneratedRubricSchema = z.object({
  title: z.string().min(1).max(200),
  criteria: z.array(GeneratedCriterionSchema).min(1),
});

export const GeneratedAssignmentWithRubricSchema = z.object({
  assignment: z.object({
    title: z.string().min(1).max(200),
    description: z.string().min(1),
  }),
  rubric: GeneratedRubricSchema,
});

export const GenerateCourseGroundedResultSchema = z.object({
  status: z.literal('grounded'),
  draft: GeneratedAssignmentWithRubricSchema,
});

export const GenerateCourseNotGroundedResultSchema = z.object({
  status: z.literal('not_grounded'),
  message: z.string(),
});

export const GenerateCourseAssignmentResultSchema = z.discriminatedUnion(
  'status',
  [GenerateCourseGroundedResultSchema, GenerateCourseNotGroundedResultSchema],
);

export const SaveGeneratedAssignmentsSchema = z.object({
  assignments: z.array(AssignmentTargetSchema).min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  dueDate: z.string().datetime(),
  rubricTitle: z.string().min(1),
  criteria: z.array(GeneratedCriterionSchema).min(1),
});

export const SavedGeneratedAssignmentSchema = z.object({
  assignmentId: z.string().uuid(),
  rubricId: z.string().uuid(),
  courseOfferingId: z.string().uuid(),
  sectionName: z.string(),
});

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
export class GenerateCourseAssignmentDto extends createZodDto(
  GenerateCourseAssignmentSchema,
) {}
export class GenerateCourseGroundedResultDto extends createZodDto(
  GenerateCourseGroundedResultSchema,
) {}
export class GenerateCourseNotGroundedResultDto extends createZodDto(
  GenerateCourseNotGroundedResultSchema,
) {}
export class SaveGeneratedAssignmentsDto extends createZodDto(
  SaveGeneratedAssignmentsSchema,
) {}
export class SavedGeneratedAssignmentDto extends createZodDto(
  SavedGeneratedAssignmentSchema,
) {}
