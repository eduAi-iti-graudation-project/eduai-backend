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
}
