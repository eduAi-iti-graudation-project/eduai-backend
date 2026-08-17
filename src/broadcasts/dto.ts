import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const BroadcastRoles = z
  .array(z.enum(['STUDENT', 'TEACHER', 'GUARDIAN', 'ADMIN']))
  .min(1, 'Pick at least one audience role');

export const CreateBroadcastSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(5000).optional(),
  targetRoles: BroadcastRoles,
  targetGradeId: z.string().uuid().optional(),
});

export class CreateBroadcastDto extends createZodDto(CreateBroadcastSchema) {}

export const BroadcastSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  body: z.string().nullable(),
  targetRoles: z.array(z.enum(['STUDENT', 'TEACHER', 'GUARDIAN', 'ADMIN'])),
  targetGradeId: z.string().uuid().nullable(),
  createdById: z.string().uuid(),
  organizationId: z.string().uuid(),
  deliveredCount: z.number(),
  createdAt: z.string().datetime(),
  createdByName: z.string().nullable(),
  targetGradeName: z.string().nullable(),
  targetGradeLevel: z.number().nullable(),
});

export class BroadcastDto extends createZodDto(BroadcastSchema) {}
