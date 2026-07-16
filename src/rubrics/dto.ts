import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const CriterionSchema = z.object({
  description: z.string().min(1),
  maxPoints: z.number().int().positive(),
});

export const CreateRubricSchema = z.object({
  title: z.string().min(1),
  assignmentId: z.string().uuid(),
  criteria: z.array(CriterionSchema).min(1),
});

export class CreateRubricDto extends createZodDto(CreateRubricSchema) {}

const ExtractedCriterionSchema = z.object({
  description: z.string().min(1),
  maxPoints: z.number().int().positive(),
});

export const ExtractedRubricSchema = z.object({
  title: z.string().optional(),
  criteria: z.array(ExtractedCriterionSchema).min(1),
});

export type ExtractedRubric = z.infer<typeof ExtractedRubricSchema>;
