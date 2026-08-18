import { Injectable, HttpStatus } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';
import { PrismaService } from '../prisma/prisma.service';
import type { Prisma } from '@prisma/client';

const alertInclude = {
  offering: {
    select: {
      id: true,
      teacher: { select: { id: true, name: true } },
    },
  },
  student: {
    select: {
      name: true,
      grade: { select: { id: true, level: true, name: true } },
      enrollments: {
        where: { status: 'APPROVED' },
        include: {
          section: {
            select: {
              id: true,
              name: true,
              gradeLevel: { select: { id: true, level: true, name: true } },
            },
          },
        },
        take: 1,
      },
    },
  },
  analyses: {
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { diagnosis: true, teacherContent: true },
  },
} satisfies Prisma.AlertInclude;

const severities = ['HIGH', 'MEDIUM', 'LOW'] as const;
const severityRank: Record<(typeof severities)[number], number> = {
  HIGH: 0,
  MEDIUM: 1,
  LOW: 2,
};

export interface TeacherFlag {
  courseOfferingId: string;
  teacherId: string;
  teacherName: string;
  courseName: string;
  sectionName: string | null;
  attribution: 'CLASS' | 'BOTH';
  severity: (typeof severities)[number];
  reason: string | null;
  headline: string | null;
  classStats: {
    studentCount: number;
    classAvgPct: number;
    droppingCount: number;
    belowAverageCount: number;
  } | null;
  alertCount: number;
  latestAt: string;
}

@Injectable()
export class AlertsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(status: string | undefined, organizationId: string) {
    const where: Record<string, unknown> = {
      student: { organizationId },
    };
    if (status) where.status = status;
    const alerts = await this.prisma.alert.findMany({
      where,
      include: alertInclude,
      orderBy: { createdAt: 'desc' },
    });
    return alerts.map((a) => ({
      id: a.id,
      type: a.type,
      reason: a.reason,
      status: a.status,
      studentId: a.studentId,
      createdAt: a.createdAt.toISOString(),
      studentName: a.student.name,
      className: a.student.enrollments[0]?.section.name ?? null,
      grade:
        a.student.grade ?? a.student.enrollments[0]?.section.gradeLevel ?? null,
      teacherName: a.offering?.teacher?.name ?? null,
      teacherId: a.offering?.teacher?.id ?? null,
      severity:
        (a.analyses[0]?.diagnosis as { severity?: string | null } | undefined)
          ?.severity ?? null,
      skillGapCount:
        (a.analyses[0]?.teacherContent as { skillGaps?: string[] } | undefined)
          ?.skillGaps?.length ?? 0,
    }));
  }

  async resolve(
    id: string,
    status: 'RESOLVED' | 'DISMISSED',
    organizationId: string,
  ) {
    const alert = await this.prisma.alert.findFirst({
      where: { id, student: { organizationId } },
    });
    if (!alert) {
      throw new ApiError(
        ErrorCode.ALERT_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This alert could not be found.',
      );
    }
    return this.prisma.alert.update({
      where: { id },
      data: { status },
    });
  }

  async findTeacherFlags(organizationId: string): Promise<TeacherFlag[]> {
    const analyses = await this.prisma.studentAnalysis.findMany({
      where: {
        offering: { organizationId },
        alertId: { not: null },
        OR: [
          { diagnosis: { path: ['attribution'], equals: 'CLASS' } },
          { diagnosis: { path: ['attribution'], equals: 'BOTH' } },
          { diagnosis: { path: ['issueType'], equals: 'CLASS_ISSUE' } },
          { diagnosis: { path: ['issueType'], equals: 'BOTH' } },
        ],
      },
      select: {
        id: true,
        alertId: true,
        createdAt: true,
        diagnosis: true,
        offering: {
          select: {
            id: true,
            course: { select: { name: true } },
            section: { select: { name: true } },
            teacher: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const byOffering = new Map<string, TeacherFlag>();

    for (const a of analyses) {
      if (!a.alertId || !a.offering) continue;
      const d = a.diagnosis as {
        attribution?: 'CLASS' | 'BOTH' | 'STUDENT';
        issueType?: string | null;
        severity?: string | null;
        reason?: string | null;
        summary?: string | null;
        brief?: { headline?: string | null };
        classStats?: {
          studentCount?: number;
          classAvgPct?: number;
          droppingCount?: number;
          belowAverageCount?: number;
        } | null;
      } | null;
      if (!d) continue;

      const attribution: 'CLASS' | 'BOTH' | null =
        d.attribution === 'CLASS' || d.attribution === 'BOTH'
          ? d.attribution
          : d.issueType === 'CLASS_ISSUE'
            ? 'CLASS'
            : d.issueType === 'BOTH'
              ? 'BOTH'
              : null;
      if (!attribution) continue;

      const severity = severities.find((s) => s === d.severity) ?? 'MEDIUM';
      const existing = byOffering.get(a.offering.id);

      if (!existing) {
        byOffering.set(a.offering.id, {
          courseOfferingId: a.offering.id,
          teacherId: a.offering.teacher.id,
          teacherName: a.offering.teacher.name,
          courseName: a.offering.course.name,
          sectionName: a.offering.section?.name ?? null,
          attribution,
          severity,
          reason: d.reason ?? d.summary ?? null,
          headline: d.brief?.headline ?? null,
          classStats: d.classStats
            ? {
                studentCount: d.classStats.studentCount ?? 0,
                classAvgPct: d.classStats.classAvgPct ?? 0,
                droppingCount: d.classStats.droppingCount ?? 0,
                belowAverageCount: d.classStats.belowAverageCount ?? 0,
              }
            : null,
          alertCount: 1,
          latestAt: a.createdAt.toISOString(),
        });
      } else {
        existing.alertCount += 1;
        if (severityRank[severity] < severityRank[existing.severity]) {
          existing.severity = severity;
        }
        if (d.reason) existing.reason = d.reason;
        const iso = a.createdAt.toISOString();
        if (iso > existing.latestAt) existing.latestAt = iso;
      }
    }

    return [...byOffering.values()]
      .sort(
        (a, b) =>
          severityRank[a.severity] - severityRank[b.severity] ||
          (a.classStats?.classAvgPct ?? 100) -
            (b.classStats?.classAvgPct ?? 100) ||
          a.latestAt.localeCompare(b.latestAt),
      )
      .slice(0, 50);
  }

  async getTeacherDetail(id: string, organizationId: string) {
    const analysis = await this.prisma.studentAnalysis.findFirst({
      where: { alertId: id, alert: { student: { organizationId } } },
    });
    if (!analysis)
      throw new ApiError(
        ErrorCode.ALERT_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'The analysis for this alert could not be found.',
      );

    const recommendations = await this.prisma.studyGeneration.findMany({
      where: { recommendedForAnalysisId: analysis.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        topic: true,
        status: true,
        stage: true,
        error: true,
        createdAt: true,
      },
    });

    return {
      diagnosis: analysis.diagnosis,
      teacherContent: analysis.teacherContent,
      guardianContent: analysis.guardianContent,
      teacherFeedback: analysis.teacherFeedback,
      managementSummary: analysis.managementSummary,
      recommendations: recommendations.map((r) => ({
        id: r.id,
        topic: r.topic,
        status: r.status,
        stage: r.stage,
        error: r.error,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  async getGuardianDetail(id: string, guardianId: string) {
    const analysis = await this.prisma.studentAnalysis.findFirst({
      where: {
        alertId: id,
        alert: { student: { guardianId } },
      },
      include: {
        alert: {
          include: { student: { select: { id: true, name: true } } },
        },
      },
    });
    if (!analysis || !analysis.alert)
      throw new ApiError(
        ErrorCode.ALERT_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'The analysis for this alert could not be found.',
      );

    const diagnosis = analysis.diagnosis as
      { summary?: string | null } | undefined;
    return {
      studentId: analysis.alert.student.id,
      studentName: analysis.alert.student.name,
      diagnosis: { summary: diagnosis?.summary ?? null },
      guardianContent: analysis.guardianContent,
    };
  }

  /** List ACTIVE alerts for a student. */
  async findByStudent(studentId: string) {
    const alerts = await this.prisma.alert.findMany({
      where: { status: 'ACTIVE', studentId },
      include: {
        student: {
          select: {
            id: true,
            name: true,
            enrollments: {
              where: { status: 'APPROVED' },
              include: {
                section: {
                  select: {
                    id: true,
                    name: true,
                    gradeLevel: {
                      select: { id: true, level: true, name: true },
                    },
                  },
                },
              },
              take: 1,
            },
          },
        },
        offering: {
          select: {
            id: true,
            teacher: { select: { id: true, name: true } },
          },
        },
        analyses: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { diagnosis: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return alerts.map((a) => ({
      id: a.id,
      type: a.type,
      reason: a.reason,
      status: a.status,
      studentId: a.studentId,
      createdAt: a.createdAt.toISOString(),
      studentName: a.student.name,
      className: a.student.enrollments[0]?.section.name ?? null,
      grade: a.student.enrollments[0]?.section.gradeLevel ?? null,
      teacherName: a.offering?.teacher?.name ?? null,
      severity:
        (a.analyses[0]?.diagnosis as { severity?: string | null } | undefined)
          ?.severity ?? null,
    }));
  }

  /** List ACTIVE alerts for the guardian's linked children. */
  async findByGuardian(guardianId: string) {
    const alerts = await this.prisma.alert.findMany({
      where: { status: 'ACTIVE', student: { guardianId } },
      include: {
        student: { select: { id: true, name: true } },
        analyses: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { diagnosis: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return alerts.map((a) => ({
      id: a.id,
      type: a.type,
      reason: a.reason,
      status: a.status,
      studentId: a.studentId,
      createdAt: a.createdAt.toISOString(),
      studentName: a.student.name,
      severity:
        (a.analyses[0]?.diagnosis as { severity?: string | null } | undefined)
          ?.severity ?? null,
    }));
  }
}
