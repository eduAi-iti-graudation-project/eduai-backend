import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UploadMaterialSchema = z.object({
  title: z.string().min(1),
  courseOfferingId: z.string().uuid(),
});

export const ChunkSearchResultSchema = z.object({
  id: z.string().uuid(),
  content: z.string(),
  distance: z.number(),
  materialId: z.string().uuid(),
  materialTitle: z.string(),
});

const MaterialSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  fileUrl: z.string().nullable(),
  courseOfferingId: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export class UploadMaterialDto extends createZodDto(UploadMaterialSchema) {}
export class MaterialDto extends createZodDto(MaterialSchema) {}
