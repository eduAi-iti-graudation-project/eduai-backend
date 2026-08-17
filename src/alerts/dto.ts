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
  grade: z
    .object({
      id: z.string().uuid(),
      level: z.number(),
      name: z.string().nullable(),
    })
    .nullable(),
  teacherName: z.string().nullable(),
  teacherId: z.string().nullable(),
  severity: z.string().nullable(),
  skillGapCount: z.number(),
});

export const ResolveAlertSchema = z.object({
  status: z.enum(['RESOLVED', 'DISMISSED']),
});

export const TeacherFlagSchema = z.object({
  courseOfferingId: z.string().uuid(),
  teacherId: z.string().uuid(),
  teacherName: z.string(),
  courseName: z.string(),
  sectionName: z.string().nullable(),
  attribution: z.enum(['CLASS', 'BOTH']),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH']).nullable(),
  reason: z.string().nullable(),
  headline: z.string().nullable(),
  classStats: z
    .object({
      studentCount: z.number(),
      classAvgPct: z.number(),
      droppingCount: z.number(),
      belowAverageCount: z.number(),
    })
    .nullable(),
  alertCount: z.number(),
  latestAt: z.string(),
});

export class AlertDto extends createZodDto(AlertSchema) {}
export class ResolveAlertDto extends createZodDto(ResolveAlertSchema) {}
export class TeacherFlagDto extends createZodDto(TeacherFlagSchema) {}
