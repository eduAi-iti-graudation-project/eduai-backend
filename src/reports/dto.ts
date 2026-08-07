import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const ParentSectionSchema = z.object({
  message: z.string(),
  homeSupport: z.array(z.string()),
});

const TeacherSectionSchema = z.object({
  analysis: z.string(),
  skillGaps: z.array(z.string()),
  interventions: z.array(z.string()),
  resourceSuggestions: z.array(z.string()),
});

const ManagementSectionSchema = z.object({
  summary: z.string(),
  classTrend: z.string(),
  recommendation: z.string(),
});

export const ReportSchema = z.object({
  id: z.string().uuid(),
  studentId: z.string().uuid(),
  alertId: z.string().uuid(),
  parentSection: ParentSectionSchema,
  teacherSection: TeacherSectionSchema,
  managementSection: ManagementSectionSchema,
  createdAt: z.string(),
});

export const ReportGenerateSchema = z.object({
  parentSection: ParentSectionSchema,
  teacherSection: TeacherSectionSchema,
  managementSection: ManagementSectionSchema,
});

export class ReportDto extends createZodDto(ReportSchema) {}
