import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateCourseSchema = z.object({
  gradeLevelId: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().optional(),
});

export const UpdateCourseSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
});

const CourseSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  gradeLevelId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export class CreateCourseDto extends createZodDto(CreateCourseSchema) {}
export class UpdateCourseDto extends createZodDto(UpdateCourseSchema) {}
export class CourseDto extends createZodDto(CourseSchema) {}
