import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UploadMaterialSchema = z.object({
  title: z.string().min(1),
  courseOfferingId: z.string().uuid(),
  assignmentId: z.string().uuid().optional(),
  chapterId: z.string().uuid().optional(),
});

export const CreateMaterialChapterSchema = z.object({
  courseOfferingId: z.string().uuid(),
  title: z.string().min(1).max(120),
});

export const CreateCourseChapterSchema = z.object({
  title: z.string().min(1).max(120),
});

export const UpdateMaterialChapterSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  order: z.number().int().min(0).optional(),
});

export const ChunkSearchResultSchema = z.object({
  id: z.string().uuid(),
  content: z.string(),
  distance: z.number(),
  materialId: z.string().uuid(),
  materialTitle: z.string(),
  chapterId: z.string().uuid().nullable(),
  chapterTitle: z.string().nullable(),
});

const MaterialSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  fileUrl: z.string().nullable(),
  courseOfferingId: z.string().uuid(),
  courseId: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const MaterialChapterSchema = z.object({
  id: z.string().uuid(),
  courseOfferingId: z.string().uuid().nullable(),
  courseId: z.string().uuid().nullable(),
  title: z.string(),
  order: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const MaterialGroupedSchema = z.object({
  chapters: z.array(
    z.object({
      id: z.string().uuid(),
      title: z.string(),
      order: z.number().int(),
      materials: z.array(MaterialSchema),
    }),
  ),
  unassigned: z.array(MaterialSchema),
});

export class UploadMaterialDto extends createZodDto(UploadMaterialSchema) {}
export class CreateMaterialChapterDto extends createZodDto(
  CreateMaterialChapterSchema,
) {}
export class CreateCourseChapterDto extends createZodDto(
  CreateCourseChapterSchema,
) {}
export class UpdateMaterialChapterDto extends createZodDto(
  UpdateMaterialChapterSchema,
) {}
export class ChunkSearchResultDto extends createZodDto(
  ChunkSearchResultSchema,
) {}
export class MaterialDto extends createZodDto(MaterialSchema) {}
export class MaterialChapterDto extends createZodDto(MaterialChapterSchema) {}
export class MaterialGroupedDto extends createZodDto(MaterialGroupedSchema) {}
