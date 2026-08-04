import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { User } from '@prisma/client';
import {
  avgPercentage,
  bucketize,
  bucketizePercent,
  bucketizeRates,
  bucketStarts,
  computeDelta,
  type ChartType,
  type Delta,
  type InsightsInterval,
  type SeriesPoint,
} from './insights.util';

export interface AgentInsight {
  title: string;
  summary: string;
}

export interface InsightSection {
  key: string;
  title: string;
  chartType: ChartType;
  series: SeriesPoint[];
  delta?: Delta;
}

export interface InsightsResponse {
  interval: InsightsInterval;
  sections: InsightSection[];
  agentInsights: AgentInsight[];
  unreadNotifications: number;
}

const TREND_BUCKETS = 24;
const VISIBLE_BUCKETS = 12;
const PASS_RATIO = 0.6;

@Injectable()
export class InsightsService {
  constructor(private readonly prisma: PrismaService) {}

  async getInsights(
    user: User,
    interval: InsightsInterval,
  ): Promise<InsightsResponse> {
    const unreadNotifications = await this.prisma.notification.count({
      where: { userId: user.id, readAt: null },
    });

    switch (user.role) {
      case 'TEACHER': {
        const { sections, agentInsights } = await this.teacherInsights(
          user.id,
          interval,
        );
        return { interval, sections, agentInsights, unreadNotifications };
      }
      case 'STUDENT': {
        const { sections, agentInsights } = await this.studentSections(
          user.id,
          interval,
        );
        return { interval, sections, agentInsights, unreadNotifications };
      }
      case 'GUARDIAN': {
        const { sections, agentInsights } = await this.guardianInsights(
          user.id,
          interval,
        );
        return { interval, sections, agentInsights, unreadNotifications };
      }
      case 'ADMIN': {
        const { sections, agentInsights } = await this.adminInsights(
          interval,
          user.organizationId,
        );
        return { interval, sections, agentInsights, unreadNotifications };
      }
    }
  }

  async getStudentInsights(
    user: User,
    studentId: string,
    interval: InsightsInterval,
  ): Promise<InsightsResponse> {
    const target = await this.prisma.user.findUnique({
      where: { id: studentId },
    });
    if (!target) {
      throw new NotFoundException('Student not found');
    }

    switch (user.role) {
      case 'STUDENT':
        if (user.id !== studentId) {
          throw new ForbiddenException('You can only view your own insights');
        }
        break;
      case 'TEACHER': {
        const cls = await this.prisma.class.findFirst({
          where: {
            teacherId: user.id,
            enrollments: { some: { studentId, status: 'APPROVED' } },
          },
          select: { id: true },
        });
        if (!cls) {
          throw new ForbiddenException(
            'You can only view insights for students in your classes',
          );
        }
        break;
      }
      case 'GUARDIAN': {
        const guardian = await this.prisma.user.findFirst({
          where: { id: user.id, wards: { some: { id: studentId } } },
          select: { id: true },
        });
        if (!guardian) {
          throw new ForbiddenException(
            'You can only view insights for your children',
          );
        }
        break;
      }
      case 'ADMIN':
        if (target.organizationId !== user.organizationId) {
          throw new ForbiddenException(
            'You can only view insights for students in your organization',
          );
        }
        break;
    }

    const unreadNotifications = await this.prisma.notification.count({
      where: { userId: user.id, readAt: null },
    });
    const { sections, agentInsights } = await this.studentSections(
      studentId,
      interval,
    );
    return { interval, sections, agentInsights, unreadNotifications };
  }

  // ── TEACHER ──────────────────────────────────────────────────────────────

  private async teacherInsights(teacherId: string, interval: InsightsInterval) {
    const since = bucketStarts(interval, TREND_BUCKETS)[0];
    const studentScope = {
      student: { enrollments: { some: { class: { teacherId } } } },
    };

    const [
      submissions,
      pendingScores,
      confirmedTrend,
      confirmedAll,
      alertsCreated,
      alertsResolved,
      attendance,
      redirects,
      analyses,
      reports,
    ] = await Promise.all([
      this.prisma.submission.findMany({
        where: {
          assignment: { class: { teacherId } },
          createdAt: { gte: since },
        },
        select: { createdAt: true },
      }),
      this.prisma.gradingScore.findMany({
        where: {
          isConfirmed: false,
          submission: { assignment: { class: { teacherId } } },
          createdAt: { gte: since },
        },
        select: { createdAt: true },
      }),
      this.prisma.gradingScore.findMany({
        where: {
          isConfirmed: true,
          submission: { assignment: { class: { teacherId } } },
          createdAt: { gte: since },
        },
        select: { createdAt: true },
      }),
      this.prisma.gradingScore.findMany({
        where: {
          isConfirmed: true,
          submission: { assignment: { class: { teacherId } } },
        },
        include: {
          criteria: { select: { maxPoints: true, description: true } },
          submission: {
            select: {
              assignment: { select: { class: { select: { name: true } } } },
            },
          },
        },
      }),
      this.prisma.alert.findMany({
        where: { createdAt: { gte: since }, ...studentScope },
        select: { createdAt: true },
      }),
      this.prisma.alert.findMany({
        where: {
          updatedAt: { gte: since },
          status: { in: ['RESOLVED', 'DISMISSED'] },
          ...studentScope,
        },
        select: { updatedAt: true },
      }),
      this.prisma.attendance.findMany({
        where: { date: { gte: since }, class: { teacherId } },
        select: { date: true, status: true },
      }),
      this.prisma.homeworkHelpInteraction.findMany({
        where: { action: 'REDIRECT_TEACHER', ...studentScope },
        include: { student: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.studentAnalysis.findMany({
        where: { ...studentScope },
        include: { student: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.studentReport.findMany({
        where: { ...studentScope },
        include: { student: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const sections: InsightSection[] = [
      this.countTrend(
        'submissions_volume',
        'Submissions per week',
        'area',
        submissions,
        interval,
      ),
      this.countTrend(
        'confirmed_grades',
        'Grades confirmed per week',
        'line',
        confirmedTrend,
        interval,
      ),
      this.countTrend(
        'pending_confirmations',
        'Grades awaiting review per week',
        'line',
        pendingScores,
        interval,
      ),
      this.countTrend(
        'alerts_created',
        'Alerts created per week',
        'area',
        alertsCreated,
        interval,
      ),
      this.countTrend(
        'alerts_resolved',
        'Alerts resolved per week',
        'area',
        alertsResolved.map((a) => ({ createdAt: a.updatedAt })),
        interval,
      ),
      this.rateTrend(
        'attendance_rate',
        'Attendance rate per week',
        attendance,
        interval,
      ),
      this.classAverageBar(confirmedAll),
      this.criterionAverageRadar(confirmedAll),
      this.strugglingStudentsBar(redirects),
    ];

    const agentInsights = this.teacherAgentInsights(
      analyses,
      reports,
      redirects,
    );

    return { sections, agentInsights };
  }

  private teacherAgentInsights(
    analyses: {
      student: { id: string; name: string };
      teacherContent: unknown;
      createdAt: Date;
    }[],
    reports: {
      student: { id: string; name: string };
      teacherSection: string;
      createdAt: Date;
    }[],
    redirects: {
      student: { id: string; name: string };
      question: string;
      createdAt: Date;
    }[],
  ): AgentInsight[] {
    const insights: AgentInsight[] = [];

    const latestByStudent = new Map<string, (typeof analyses)[number]>();
    for (const a of analyses) {
      const existing = latestByStudent.get(a.student.id);
      if (!existing || a.createdAt > existing.createdAt) {
        latestByStudent.set(a.student.id, a);
      }
    }
    for (const a of latestByStudent.values()) {
      insights.push({
        title: `${a.student.name} — flagged`,
        summary: this.summarizeJson(a.teacherContent, 'Student flagged'),
      });
    }

    const latestReportByStudent = new Map<string, (typeof reports)[number]>();
    for (const r of reports) {
      const existing = latestReportByStudent.get(r.student.id);
      if (!existing || r.createdAt > existing.createdAt) {
        latestReportByStudent.set(r.student.id, r);
      }
    }
    for (const r of latestReportByStudent.values()) {
      insights.push({
        title: `${r.student.name} — report`,
        summary: r.teacherSection,
      });
    }

    for (const r of redirects.slice(0, 5)) {
      insights.push({
        title: `${r.student.name} asked for help`,
        summary: r.question,
      });
    }

    return insights;
  }

  // ── STUDENT (also used by the drill-down) ───────────────────────────────

  private async studentSections(studentId: string, interval: InsightsInterval) {
    const since = bucketStarts(interval, TREND_BUCKETS)[0];

    const [confirmedAll, attendance, interactions, activeAlerts, latestReport] =
      await Promise.all([
        this.prisma.gradingScore.findMany({
          where: { isConfirmed: true, submission: { studentId } },
          include: {
            criteria: { select: { maxPoints: true, description: true } },
            submission: { select: { createdAt: true } },
          },
        }),
        this.prisma.attendance.findMany({
          where: { studentId, date: { gte: since } },
          select: { date: true, status: true },
        }),
        this.prisma.homeworkHelpInteraction.findMany({
          where: { studentId },
          select: { action: true },
        }),
        this.prisma.alert.findMany({
          where: { studentId, status: 'ACTIVE' },
          select: { type: true, reason: true },
        }),
        this.prisma.studentReport.findMany({
          where: { studentId },
          select: { teacherSection: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        }),
      ]);

    const sections: InsightSection[] = [
      this.percentTrend(
        'grade_trend',
        'My grades over time',
        confirmedAll.map((s) => ({
          createdAt: s.submission.createdAt,
          pct: this.ratioToPercent(s.pointsAwarded, s.criteria.maxPoints),
        })),
        interval,
      ),
      this.rateTrend(
        'attendance_trend',
        'My attendance per week',
        attendance,
        interval,
      ),
      this.criterionStrengthsRadar(confirmedAll),
      this.helpActionDonut(interactions),
    ];

    const agentInsights: AgentInsight[] = [];
    for (const a of activeAlerts) {
      agentInsights.push({
        title: `Alert: ${a.type}`,
        summary: a.reason,
      });
    }
    if (latestReport[0]) {
      agentInsights.push({
        title: 'Latest report',
        summary: latestReport[0].teacherSection,
      });
    }

    return { sections, agentInsights };
  }

  // ── GUARDIAN ─────────────────────────────────────────────────────────────

  private async guardianInsights(
    guardianId: string,
    interval: InsightsInterval,
  ) {
    const guardian = await this.prisma.user.findUnique({
      where: { id: guardianId },
      include: { wards: { select: { id: true, name: true } } },
    });
    if (!guardian) return { sections: [], agentInsights: [] };

    const since = bucketStarts(interval, TREND_BUCKETS)[0];
    const sections: InsightSection[] = [];
    const agentInsights: AgentInsight[] = [];

    for (const ward of guardian.wards) {
      const [confirmed, attendance, alerts, latestReport, latestAnalysis] =
        await Promise.all([
          this.prisma.gradingScore.findMany({
            where: { isConfirmed: true, submission: { studentId: ward.id } },
            include: {
              criteria: { select: { maxPoints: true, description: true } },
              submission: { select: { createdAt: true } },
            },
          }),
          this.prisma.attendance.findMany({
            where: { studentId: ward.id, date: { gte: since } },
            select: { date: true, status: true },
          }),
          this.prisma.alert.findMany({
            where: { studentId: ward.id, createdAt: { gte: since } },
            select: { createdAt: true },
          }),
          this.prisma.studentReport.findMany({
            where: { studentId: ward.id },
            select: { parentSection: true },
            orderBy: { createdAt: 'desc' },
            take: 1,
          }),
          this.prisma.studentAnalysis.findMany({
            where: { studentId: ward.id },
            select: { guardianContent: true },
            orderBy: { createdAt: 'desc' },
            take: 1,
          }),
        ]);

      sections.push(
        this.percentTrend(
          `child_${ward.id}_grades`,
          `${ward.name} grades over time`,
          confirmed.map((s) => ({
            createdAt: s.submission.createdAt,
            pct: this.ratioToPercent(s.pointsAwarded, s.criteria.maxPoints),
          })),
          interval,
        ),
        this.rateTrend(
          `child_${ward.id}_attendance`,
          `${ward.name} attendance per week`,
          attendance,
          interval,
        ),
        this.countTrend(
          `child_${ward.id}_alerts`,
          `${ward.name} alerts created per week`,
          'area',
          alerts,
          interval,
        ),
      );

      if (latestReport[0]) {
        agentInsights.push({
          title: `${ward.name} — report`,
          summary: latestReport[0].parentSection,
        });
      }
      if (latestAnalysis[0]) {
        agentInsights.push({
          title: `${ward.name} — analysis`,
          summary: this.summarizeJson(
            latestAnalysis[0].guardianContent,
            'Guardian analysis',
          ),
        });
      }
    }

    return { sections, agentInsights };
  }

  // ── ADMIN ────────────────────────────────────────────────────────────────

  private async adminInsights(
    interval: InsightsInterval,
    organizationId: string,
  ) {
    const since = bucketStarts(interval, TREND_BUCKETS)[0];

    const [
      submissions,
      confirmedTrend,
      allConfirmed,
      alertsCreated,
      allAlerts,
      users,
      teachers,
      reports,
    ] = await Promise.all([
      this.prisma.submission.findMany({
        where: {
          createdAt: { gte: since },
          assignment: { class: { organizationId } },
        },
        select: { createdAt: true },
      }),
      this.prisma.gradingScore.findMany({
        where: {
          isConfirmed: true,
          createdAt: { gte: since },
          submission: { assignment: { class: { organizationId } } },
        },
        select: { createdAt: true },
      }),
      this.prisma.gradingScore.findMany({
        where: {
          isConfirmed: true,
          submission: { assignment: { class: { organizationId } } },
        },
        include: { criteria: { select: { maxPoints: true } } },
      }),
      this.prisma.alert.findMany({
        where: {
          createdAt: { gte: since },
          student: { organizationId },
        },
        select: { createdAt: true },
      }),
      this.prisma.alert.findMany({
        where: { student: { organizationId } },
        select: { status: true },
      }),
      this.prisma.user.findMany({
        where: {
          role: { in: ['STUDENT', 'TEACHER'] },
          organizationId,
          createdAt: { gte: since },
        },
        select: { createdAt: true },
      }),
      this.prisma.user.findMany({
        where: { role: 'TEACHER', organizationId },
        select: {
          id: true,
          name: true,
          taughtClasses: {
            select: {
              enrollments: {
                where: { status: 'APPROVED' },
                select: { id: true },
              },
              assignments: {
                select: {
                  submissions: {
                    select: {
                      scores: {
                        select: {
                          isConfirmed: true,
                          pointsAwarded: true,
                          criteria: { select: { maxPoints: true } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      this.prisma.studentReport.findMany({
        where: { student: { organizationId } },
        select: {
          managementSection: true,
          student: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ]);

    const sections: InsightSection[] = [
      this.countTrend(
        'submissions_volume',
        'Submissions per week (school)',
        'area',
        submissions,
        interval,
      ),
      this.countTrend(
        'confirmed_grades',
        'Grades confirmed per week',
        'line',
        confirmedTrend,
        interval,
      ),
      this.percentTrend(
        'pass_rate_trend',
        'Pass rate per week',
        allConfirmed.map((s) => ({
          createdAt: s.createdAt,
          pct:
            s.criteria.maxPoints > 0 &&
            s.pointsAwarded / s.criteria.maxPoints >= PASS_RATIO
              ? 100
              : 0,
        })),
        interval,
      ),
      this.countTrend(
        'alerts_created',
        'Alerts created per week',
        'area',
        alertsCreated,
        interval,
      ),
      this.userGrowthBar(users, interval),
      this.teacherWorkloadBar(teachers),
      this.alertStatusDonut(allAlerts),
    ];

    const agentInsights: AgentInsight[] = [];
    for (const r of reports) {
      agentInsights.push({
        title: `${r.student.name} — management`,
        summary: r.managementSection,
      });
    }
    for (const t of teachers) {
      const pending = t.taughtClasses
        .flatMap((c) => c.assignments)
        .flatMap((a) => a.submissions)
        .flatMap((s) => s.scores)
        .filter((s) => !s.isConfirmed).length;
      const students = t.taughtClasses.reduce(
        (sum, c) => sum + c.enrollments.length,
        0,
      );
      const confirmed = t.taughtClasses
        .flatMap((c) => c.assignments)
        .flatMap((a) => a.submissions)
        .flatMap((s) => s.scores)
        .filter((s) => s.isConfirmed);
      const average = avgPercentage(
        confirmed.map((s) => ({
          pointsAwarded: s.pointsAwarded,
          maxPoints: s.criteria.maxPoints,
        })),
      );
      agentInsights.push({
        title: `${t.name} — workload`,
        summary: `Average ${average}% · ${pending} pending reviews · ${students} students`,
      });
    }

    return { sections, agentInsights };
  }

  // ── Shared section builders ──────────────────────────────────────────────

  private countTrend(
    key: string,
    title: string,
    chartType: ChartType,
    rows: { createdAt: Date }[],
    interval: InsightsInterval,
  ): InsightSection {
    const series = bucketize(rows, interval, TREND_BUCKETS);
    const current = series.slice(VISIBLE_BUCKETS);
    const sum = (points: SeriesPoint[]) =>
      points.reduce((a, b) => a + b.value, 0);
    return {
      key,
      title,
      chartType,
      series: current,
      delta: computeDelta(sum(current), sum(series.slice(0, VISIBLE_BUCKETS))),
    };
  }

  private rateTrend(
    key: string,
    title: string,
    rows: { date: Date; status: string }[],
    interval: InsightsInterval,
  ): InsightSection {
    const series = bucketizeRates(
      rows.map((r) => ({ date: r.date, present: r.status === 'PRESENT' })),
      interval,
      TREND_BUCKETS,
    );
    const current = series.slice(VISIBLE_BUCKETS);
    const avg = (points: SeriesPoint[]) =>
      points.length > 0
        ? points.reduce((a, b) => a + b.value, 0) / points.length
        : 0;
    return {
      key,
      title,
      chartType: 'line',
      series: current,
      delta: computeDelta(avg(current), avg(series.slice(0, VISIBLE_BUCKETS))),
    };
  }

  private percentTrend(
    key: string,
    title: string,
    rows: { createdAt: Date; pct: number }[],
    interval: InsightsInterval,
  ): InsightSection {
    const series = bucketizePercent(rows, interval, TREND_BUCKETS);
    const current = series.slice(VISIBLE_BUCKETS);
    const avg = (points: SeriesPoint[]) =>
      points.length > 0
        ? points.reduce((a, b) => a + b.value, 0) / points.length
        : 0;
    return {
      key,
      title,
      chartType: 'line',
      series: current,
      delta: computeDelta(avg(current), avg(series.slice(0, VISIBLE_BUCKETS))),
    };
  }

  private classAverageBar(
    confirmed: {
      pointsAwarded: number;
      criteria: { maxPoints: number };
      submission: {
        assignment: { class: { name: string } };
      };
    }[],
  ): InsightSection {
    const byClass = new Map<
      string,
      { pointsAwarded: number; maxPoints: number }[]
    >();
    for (const s of confirmed) {
      const name = s.submission.assignment.class.name;
      const bucket = byClass.get(name) ?? [];
      bucket.push({
        pointsAwarded: s.pointsAwarded,
        maxPoints: s.criteria.maxPoints,
      });
      byClass.set(name, bucket);
    }
    const series = Array.from(byClass.entries())
      .map(([label, scores]) => ({ label, value: avgPercentage(scores) }))
      .sort((a, b) => b.value - a.value);
    return {
      key: 'class_average',
      title: 'Average score per class',
      chartType: 'bar',
      series,
    };
  }

  private criterionAverageRadar(
    confirmed: {
      pointsAwarded: number;
      criteria: { maxPoints: number; description: string };
    }[],
    key = 'criterion_average',
    title = 'Average score per criterion',
  ): InsightSection {
    const byCriteria = new Map<
      string,
      { pointsAwarded: number; maxPoints: number }[]
    >();
    for (const s of confirmed) {
      const name = s.criteria.description;
      const bucket = byCriteria.get(name) ?? [];
      bucket.push({
        pointsAwarded: s.pointsAwarded,
        maxPoints: s.criteria.maxPoints,
      });
      byCriteria.set(name, bucket);
    }
    const series = Array.from(byCriteria.entries()).map(([label, scores]) => ({
      label,
      value: avgPercentage(scores),
    }));
    return { key, title, chartType: 'radar', series };
  }

  private criterionStrengthsRadar(
    confirmed: {
      pointsAwarded: number;
      criteria: { maxPoints: number; description: string };
    }[],
  ): InsightSection {
    return this.criterionAverageRadar(
      confirmed,
      'criterion_strengths',
      'Strengths by criterion',
    );
  }

  private strugglingStudentsBar(
    redirects: { student: { name: string } }[],
  ): InsightSection {
    const counts = new Map<string, number>();
    for (const r of redirects) {
      counts.set(r.student.name, (counts.get(r.student.name) ?? 0) + 1);
    }
    const series = Array.from(counts.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
    return {
      key: 'struggling_students',
      title: 'Homework-helper redirects per student',
      chartType: 'bar',
      series,
    };
  }

  private helpActionDonut(interactions: { action: string }[]): InsightSection {
    const counts = new Map<string, number>();
    for (const i of interactions) {
      counts.set(i.action, (counts.get(i.action) ?? 0) + 1);
    }
    const series = Array.from(counts.entries()).map(([label, value]) => ({
      label,
      value,
    }));
    return {
      key: 'help_action_split',
      title: 'Homework-helper outcomes',
      chartType: 'donut',
      series,
    };
  }

  private userGrowthBar(
    users: { createdAt: Date }[],
    interval: InsightsInterval,
  ): InsightSection {
    const series = bucketize(users, interval, VISIBLE_BUCKETS);
    return {
      key: 'user_growth',
      title: 'Students & teachers per bucket',
      chartType: 'bar',
      series,
    };
  }

  private teacherWorkloadBar(
    teachers: {
      name: string;
      taughtClasses: {
        enrollments: { id: string }[];
        assignments: {
          submissions: { scores: { isConfirmed: boolean }[] }[];
        }[];
      }[];
    }[],
  ): InsightSection {
    const series = teachers.map((t) => {
      const pending = t.taughtClasses
        .flatMap((c) => c.assignments)
        .flatMap((a) => a.submissions)
        .flatMap((s) => s.scores)
        .filter((s) => !s.isConfirmed).length;
      const students = t.taughtClasses.reduce(
        (sum, c) => sum + c.enrollments.length,
        0,
      );
      return { label: t.name, value: pending + students };
    });
    series.sort((a, b) => b.value - a.value);
    return {
      key: 'teacher_workload',
      title: 'Pending reviews per teacher',
      chartType: 'bar',
      series,
    };
  }

  private alertStatusDonut(alerts: { status: string }[]): InsightSection {
    const counts = new Map<string, number>();
    for (const a of alerts) {
      counts.set(a.status, (counts.get(a.status) ?? 0) + 1);
    }
    const series = Array.from(counts.entries()).map(([label, value]) => ({
      label,
      value,
    }));
    return {
      key: 'alert_status_split',
      title: 'Alert status distribution',
      chartType: 'donut',
      series,
    };
  }

  private ratioToPercent(pointsAwarded: number, maxPoints: number): number {
    return maxPoints > 0
      ? Math.round((pointsAwarded / maxPoints) * 1000) / 10
      : 0;
  }

  private summarizeJson(content: unknown, fallback: string): string {
    if (content === null || content === undefined) return fallback;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.join(', ');
    const obj = content as Record<string, unknown>;
    if (Array.isArray(obj.skillGaps)) {
      return `Skill gaps: ${(obj.skillGaps as unknown[]).join(', ')}`;
    }
    return JSON.stringify(obj).slice(0, 200);
  }
}
