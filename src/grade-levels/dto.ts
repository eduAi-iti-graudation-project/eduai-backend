import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateGradeLevelSchema = z.object({
  level: z.number().int().min(1).max(12),
  name: z.string().min(1).optional(),
});

export const UpdateGradeLevelSchema = z.object({
  level: z.number().int().min(1).max(12).optional(),
  name: z.string().min(1).optional(),
});

const GradeLevelSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  level: z.number().int(),
  name: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export class CreateGradeLevelDto extends createZodDto(CreateGradeLevelSchema) {}
export class UpdateGradeLevelDto extends createZodDto(UpdateGradeLevelSchema) {}
export class GradeLevelDto extends createZodDto(GradeLevelSchema) {}
