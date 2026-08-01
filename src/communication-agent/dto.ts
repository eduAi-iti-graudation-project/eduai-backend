import { z } from 'zod';

export const DiagnosisSchema = z.object({
  hasIssue: z.boolean(),
  issueType: z.enum(['STUDENT_ISSUE', 'CLASS_ISSUE', 'BOTH']).nullable(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH']).nullable(),
  summary: z.string().nullable(),
  classContext: z.string().nullable(),
});

export type Diagnosis = z.infer<typeof DiagnosisSchema>;

export const TeacherStudentContentSchema = z.object({
  analysis: z.string(),
  skillGaps: z.array(z.string()),
  interventions: z.array(z.string()),
  resourceSuggestions: z.array(z.string()),
});

export type TeacherStudentContent = z.infer<typeof TeacherStudentContentSchema>;

export const GuardianStudentContentSchema = z.object({
  message: z.string(),
  homeSupport: z.array(z.string()),
});

export type GuardianStudentContent = z.infer<
  typeof GuardianStudentContentSchema
>;

export const TeacherFeedbackSchema = z.object({
  feedback: z.string(),
  patternAnalysis: z.string(),
  strategies: z.array(z.string()),
});

export type TeacherFeedback = z.infer<typeof TeacherFeedbackSchema>;

export const ManagementSummarySchema = z.object({
  summary: z.string(),
  classTrend: z.string(),
  recommendation: z.string(),
});

export type ManagementSummary = z.infer<typeof ManagementSummarySchema>;

export const StudentProfileSchema = z.object({
  grades: z.array(
    z.object({
      submissionId: z.string(),
      pointsAwarded: z.number(),
      maxPoints: z.number(),
      percentage: z.number(),
      criteriaDescription: z.string(),
      createdAt: z.string(),
    }),
  ),
  attendance: z.array(
    z.object({
      date: z.string(),
      status: z.string(),
      className: z.string().optional(),
    }),
  ),
  previousAlerts: z.array(
    z.object({
      type: z.string(),
      reason: z.string(),
      status: z.string(),
      createdAt: z.string(),
    }),
  ),
  studentName: z.string(),
});

export type StudentProfile = z.infer<typeof StudentProfileSchema>;

export const ClassContextSchema = z.object({
  className: z.string(),
  teacherName: z.string(),
  averageScore: z.number(),
  totalStudents: z.number(),
  belowAverageCount: z.number(),
  teacherOtherClasses: z.array(
    z.object({
      className: z.string(),
      averageScore: z.number(),
      studentCount: z.number(),
    }),
  ),
});

export type ClassContext = z.infer<typeof ClassContextSchema>;

export const AnalysisLogSchema = z.object({
  submissionId: z.string(),
  studentId: z.string(),
  classId: z.string().optional(),
  diagnosis: DiagnosisSchema,
  alertCreated: z.boolean(),
  alertId: z.string().nullable(),
  reportGenerated: z.boolean(),
  notificationsSent: z.array(z.string()),
  timestamp: z.string(),
});
