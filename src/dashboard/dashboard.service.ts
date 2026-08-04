import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { User } from '@prisma/client';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getOverview(user: User) {
    switch (user.role) {
      case 'TEACHER':
        return this.teacherDashboard(user.id);
      case 'STUDENT':
        return this.studentDashboard(user.id);
      case 'GUARDIAN':
        return this.guardianDashboard(user.id);
      case 'ADMIN':
        return this.adminDashboard(user.organizationId);
    }
  }

  private async teacherDashboard(teacherId: string) {
    const [
      classCount,
      pendingConfirmations,
      activeAlertCount,
      resolvedAlertCount,
      recentAlerts,
      submissionsNeedingReview,
      unreadNotifications,
    ] = await Promise.all([
      this.prisma.class.count({ where: { teacherId } }),

      this.prisma.gradingScore.count({
        where: {
          isConfirmed: false,
          submission: {
            assignment: { class: { teacherId } },
          },
        },
      }),

      this.prisma.alert.count({
        where: {
          status: 'ACTIVE',
          student: { enrollments: { some: { class: { teacherId } } } },
        },
      }),

      this.prisma.alert.count({
        where: {
          status: { in: ['RESOLVED', 'DISMISSED'] },
          student: { enrollments: { some: { class: { teacherId } } } },
        },
      }),

      this.prisma.alert.findMany({
        where: {
          student: {
            enrollments: { some: { class: { teacherId } } },
          },
        },
        include: { student: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),

      this.prisma.submission.findMany({
        where: {
          status: 'REVIEW_READY',
          assignment: { class: { teacherId } },
        },
        include: {
          student: true,
          assignment: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),

      this.prisma.notification.count({
        where: { userId: teacherId, readAt: null },
      }),
    ]);

    return {
      classCount,
      pendingConfirmations,
      activeAlertCount,
      resolvedAlertCount,
      recentAlerts: recentAlerts.map((a) => ({
        id: a.id,
        studentName: a.student.name,
        type: a.type,
        reason: a.reason,
        createdAt: a.createdAt.toISOString(),
      })),
      submissionsNeedingReview: (
        submissionsNeedingReview as {
          student: { name: string };
          assignment: { title: string };
          createdAt: Date;
          id: string;
        }[]
      ).map((s) => ({
        id: s.id,
        studentName: s.student.name,
        assignmentTitle: s.assignment.title,
        createdAt: s.createdAt.toISOString(),
      })),
      unreadNotifications,
    };
  }

  private async studentDashboard(studentId: string) {
    const [
      enrollments,
      confirmedScores,
      attendanceRecords,
      activeAlerts,
      unreadNotifications,
    ] = await Promise.all([
      this.prisma.enrollment.findMany({
        where: { studentId },
        include: {
          class: {
            include: {
              assignments: {
                where: { dueDate: { gte: new Date() } },
                orderBy: { dueDate: 'asc' },
                take: 10,
              },
            },
          },
        },
      }),

      this.prisma.gradingScore.findMany({
        where: {
          isConfirmed: true,
          submission: { studentId },
        },
        include: {
          submission: { include: { assignment: true } },
          criteria: true,
        },
        orderBy: { submission: { createdAt: 'desc' } },
        take: 10,
      }),

      this.prisma.attendance.findMany({
        where: { studentId },
      }),

      this.prisma.alert.findMany({
        where: { studentId, status: 'ACTIVE' },
      }),

      this.prisma.notification.count({
        where: { userId: studentId, readAt: null },
      }),
    ]);

    const totalAttendance = attendanceRecords.length;
    const presentCount = attendanceRecords.filter(
      (r) => r.status === 'PRESENT',
    ).length;
    const attendanceRate =
      totalAttendance > 0 ? presentCount / totalAttendance : 0;

    const gradesByAssignment = new Map<
      string,
      { title: string; total: number; earned: number }
    >();
    for (const gs of confirmedScores) {
      const assignment = gs.submission.assignment;
      const key = assignment.id;
      const existing = gradesByAssignment.get(key);
      if (existing) {
        existing.earned += gs.pointsAwarded;
      } else {
        gradesByAssignment.set(key, {
          title: assignment.title,
          total: assignment.totalPoints,
          earned: gs.pointsAwarded,
        });
      }
    }

    const upcomingAssignments = enrollments.flatMap((e) =>
      e.class.assignments.map((a) => ({
        title: a.title,
        dueDate: a.dueDate.toISOString(),
        className: e.class.name,
      })),
    );

    const recentGrades = Array.from(gradesByAssignment.values()).map((g) => ({
      assignmentTitle: g.title,
      score: g.earned,
      totalPoints: g.total,
      percentage: g.total > 0 ? Math.round((g.earned / g.total) * 100) : 0,
    }));

    return {
      upcomingAssignments,
      recentGrades,
      attendanceRate: Math.round(attendanceRate * 100) / 100,
      activeAlerts: activeAlerts.map((a) => ({
        id: a.id,
        type: a.type,
        reason: a.reason,
      })),
      unreadNotifications,
    };
  }

  private async guardianDashboard(guardianId: string) {
    const guardian = await this.prisma.user.findUnique({
      where: { id: guardianId },
      include: {
        wards: {
          include: {
            enrollments: {
              include: { class: true },
              take: 1,
            },
          },
        },
      },
    });

    if (!guardian) return { children: [], unreadNotifications: 0 };

    const children = await Promise.all(
      guardian.wards.map(async (ward) => {
        const [
          confirmedScores,
          attendanceRecords,
          activeAlerts,
          unreadReports,
        ] = await Promise.all([
          this.prisma.gradingScore.findMany({
            where: { isConfirmed: true, submission: { studentId: ward.id } },
          }),
          this.prisma.attendance.findMany({ where: { studentId: ward.id } }),
          this.prisma.alert.count({
            where: { studentId: ward.id, status: 'ACTIVE' },
          }),
          this.prisma.studentReport.count({
            where: { studentId: ward.id, status: { not: 'VIEWED' } },
          }),
        ]);

        const totalAttendance = attendanceRecords.length;
        const presentCount = attendanceRecords.filter(
          (r) => r.status === 'PRESENT',
        ).length;
        const attendanceRate =
          totalAttendance > 0 ? presentCount / totalAttendance : 0;

        const totalEarned = confirmedScores.reduce(
          (s, g) => s + g.pointsAwarded,
          0,
        );
        const overallAverage =
          confirmedScores.length > 0 ? totalEarned / confirmedScores.length : 0;

        const className = ward.enrollments[0]?.class.name ?? '';

        return {
          id: ward.id,
          name: ward.name,
          className,
          overallAverage: Math.round(overallAverage * 100) / 100,
          attendanceRate: Math.round(attendanceRate * 100) / 100,
          activeAlertCount: activeAlerts,
          unreadReportCount: unreadReports,
        };
      }),
    );

    const unreadNotifications = await this.prisma.notification.count({
      where: { userId: guardianId, readAt: null },
    });

    return { children, unreadNotifications };
  }

  private async adminDashboard(organizationId: string) {
    const [
      teacherCount,
      studentCount,
      classCount,
      flaggedStudents,
      pendingReports,
      unreadNotifications,
      teachers,
    ] = await Promise.all([
      this.prisma.user.count({
        where: { role: 'TEACHER', organizationId },
      }),
      this.prisma.user.count({
        where: { role: 'STUDENT', organizationId },
      }),
      this.prisma.class.count({ where: { organizationId } }),
      this.prisma.user.count({
        where: {
          role: 'STUDENT',
          organizationId,
          alerts: { some: { status: 'ACTIVE' } },
        },
      }),
      this.prisma.studentReport.count({
        where: { student: { organizationId }, status: 'NEW' },
      }),
      this.prisma.notification.count({
        where: { user: { organizationId }, readAt: null },
      }),
      this.prisma.user.findMany({
        where: { role: 'TEACHER', organizationId },
        include: {
          taughtClasses: {
            include: {
              assignments: {
                include: {
                  submissions: {
                    include: { scores: { where: { isConfirmed: true } } },
                  },
                },
              },
            },
          },
        },
      }),
    ]);

    const teacherSummaries = teachers.map((t) => {
      let totalEarned = 0;
      const totalMax = 0;
      const studentIds = new Set<string>();
      for (const cls of t.taughtClasses) {
        for (const a of cls.assignments) {
          for (const sub of a.submissions) {
            studentIds.add(sub.studentId);
            for (const score of sub.scores) {
              totalEarned += score.pointsAwarded;
            }
          }
        }
      }
      return {
        id: t.id,
        name: t.name,
        classAverage:
          totalMax > 0 ? Math.round((totalEarned / totalMax) * 100) / 100 : 0,
        studentCount: studentIds.size,
      };
    });

    const passRate = await this.computePassRate(organizationId);

    return {
      teacherCount,
      studentCount,
      classCount,
      flaggedStudentCount: flaggedStudents,
      averagePassRate: passRate,
      pendingReportCount: pendingReports,
      teachers: teacherSummaries,
      unreadNotifications,
    };
  }

  private async computePassRate(organizationId: string): Promise<number> {
    const scores = await this.prisma.gradingScore.findMany({
      where: {
        isConfirmed: true,
        submission: { assignment: { class: { organizationId } } },
      },
      include: { criteria: true },
    });

    if (scores.length === 0) return 0;

    const passing = scores.filter(
      (s) =>
        s.criteria.maxPoints > 0 &&
        s.pointsAwarded / s.criteria.maxPoints >= 0.6,
    );

    return Math.round((passing.length / scores.length) * 100) / 100;
  }
}
