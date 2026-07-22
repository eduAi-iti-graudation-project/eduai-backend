import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const TeacherDashboardSchema = z.object({
  classCount: z.number(),
  pendingConfirmations: z.number(),
  recentAlerts: z.array(
    z.object({
      id: z.string().uuid(),
      studentName: z.string(),
      type: z.string(),
      reason: z.string(),
      createdAt: z.string(),
    }),
  ),
  submissionsNeedingReview: z.array(
    z.object({
      id: z.string().uuid(),
      studentName: z.string(),
      assignmentTitle: z.string(),
      createdAt: z.string(),
    }),
  ),
  unreadNotifications: z.number(),
});

const StudentDashboardSchema = z.object({
  upcomingAssignments: z.array(
    z.object({
      title: z.string(),
      dueDate: z.string(),
      className: z.string(),
    }),
  ),
  recentGrades: z.array(
    z.object({
      assignmentTitle: z.string(),
      score: z.number(),
      totalPoints: z.number(),
      percentage: z.number(),
    }),
  ),
  attendanceRate: z.number(),
  activeAlerts: z.array(
    z.object({
      id: z.string().uuid(),
      type: z.string(),
      reason: z.string(),
    }),
  ),
  unreadNotifications: z.number(),
});

const GuardianChildSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  className: z.string(),
  overallAverage: z.number(),
  attendanceRate: z.number(),
  activeAlertCount: z.number(),
  unreadReportCount: z.number(),
});

const GuardianDashboardSchema = z.object({
  children: z.array(GuardianChildSchema),
  unreadNotifications: z.number(),
});

const AdminTeacherSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  classAverage: z.number(),
  studentCount: z.number(),
});

const AdminDashboardSchema = z.object({
  teacherCount: z.number(),
  studentCount: z.number(),
  classCount: z.number(),
  flaggedStudentCount: z.number(),
  averagePassRate: z.number(),
  pendingReportCount: z.number(),
  teachers: z.array(AdminTeacherSummarySchema),
  unreadNotifications: z.number(),
});

export class TeacherDashboardDto extends createZodDto(TeacherDashboardSchema) {}
export class StudentDashboardDto extends createZodDto(StudentDashboardSchema) {}
export class GuardianDashboardDto extends createZodDto(
  GuardianDashboardSchema,
) {}
export class AdminDashboardDto extends createZodDto(AdminDashboardSchema) {}
