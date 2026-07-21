import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ReportSchema = z.object({
  id: z.string().uuid(),
  studentId: z.string().uuid(),
  alertId: z.string().uuid(),
  parentSection: z.string(),
  teacherSection: z.string(),
  managementSection: z.string(),
  createdAt: z.string(),
});

export const ReportGenerateSchema = z.object({
  parentSection: z.string(),
  teacherSection: z.string(),
  managementSection: z.string(),
});

export class ReportDto extends createZodDto(ReportSchema) {}
