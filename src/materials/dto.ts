import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UploadMaterialSchema = z
  .object({
    title: z.string().min(1),
    courseOfferingId: z.string().uuid().optional(),
    sectionId: z.string().uuid().optional(),
    courseId: z.string().uuid().optional(),
    assignmentId: z.string().uuid().optional(),
    chapterId: z.string().uuid().optional(),
  })
  .superRefine((data, ctx) => {
    const hasOffering = Boolean(data.courseOfferingId);
    const hasSection = Boolean(data.sectionId);
    const hasCourse = Boolean(data.courseId);
    if (!hasOffering && !hasSection && !hasCourse) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'One of courseOfferingId, sectionId or courseId is required.',
        path: ['courseOfferingId'],
      });
    }
    if (hasOffering && hasSection) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide either courseOfferingId or sectionId, not both.',
        path: ['sectionId'],
      });
    }
    if (hasOffering && hasCourse) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'courseId is redundant when courseOfferingId is provided.',
        path: ['courseId'],
      });
    }
  });

export const CreateMaterialChapterSchema = z
  .object({
    courseOfferingId: z.string().uuid().optional(),
    sectionId: z.string().uuid().optional(),
    courseId: z.string().uuid().optional(),
    title: z.string().min(1).max(120),
  })
  .superRefine((data, ctx) => {
    const targetCount = [
      data.courseOfferingId,
      data.sectionId,
      data.courseId,
    ].filter(Boolean).length;
    if (targetCount !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Exactly one of courseOfferingId, sectionId or courseId is required.',
        path: ['courseOfferingId'],
      });
    }
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
  courseOfferingId: z.string().uuid().nullable(),
  courseId: z.string().uuid().nullable(),
  courseName: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const MaterialChapterSchema = z.object({
  id: z.string().uuid(),
  courseOfferingId: z.string().uuid().nullable(),
  courseId: z.string().uuid().nullable(),
  courseName: z.string().nullable().optional(),
  title: z.string(),
  order: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const MaterialGroupedSchema = z.object({
  chapters: z.array(
    z.object({
      id: z.string().uuid(),
      courseOfferingId: z.string().uuid().nullable().optional(),
      courseId: z.string().uuid().nullable().optional(),
      courseName: z.string().nullable().optional(),
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
