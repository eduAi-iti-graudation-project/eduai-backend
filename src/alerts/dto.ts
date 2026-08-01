import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const AlertSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  reason: z.string(),
  status: z.string(),
  studentId: z.string().uuid(),
  createdAt: z.string(),
  studentName: z.string(),
  className: z.string().nullable(),
  severity: z.string().nullable(),
  skillGapCount: z.number(),
});

export const ResolveAlertSchema = z.object({
  status: z.enum(['RESOLVED', 'DISMISSED']),
});

export class AlertDto extends createZodDto(AlertSchema) {}
export class ResolveAlertDto extends createZodDto(ResolveAlertSchema) {}
