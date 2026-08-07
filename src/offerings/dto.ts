import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateOfferingSchema = z.object({
  courseId: z.string().uuid(),
  sectionId: z.string().uuid(),
  teacherId: z.string().uuid(),
});

export const UpdateOfferingSchema = z.object({
  teacherId: z.string().uuid().optional(),
});

const OfferingSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  courseId: z.string().uuid(),
  sectionId: z.string().uuid(),
  teacherId: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export class CreateOfferingDto extends createZodDto(CreateOfferingSchema) {}
export class UpdateOfferingDto extends createZodDto(UpdateOfferingSchema) {}
export class OfferingDto extends createZodDto(OfferingSchema) {}
