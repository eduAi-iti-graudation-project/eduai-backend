import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateSectionSchema = z.object({
  gradeLevelId: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().optional(),
});

export const UpdateSectionSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
});

export const AddSectionEnrollmentSchema = z.object({
  studentId: z.string().uuid(),
});

const SectionSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  gradeLevelId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export class CreateSectionDto extends createZodDto(CreateSectionSchema) {}
export class UpdateSectionDto extends createZodDto(UpdateSectionSchema) {}
export class AddSectionEnrollmentDto extends createZodDto(
  AddSectionEnrollmentSchema,
) {}
export class SectionDto extends createZodDto(SectionSchema) {}
