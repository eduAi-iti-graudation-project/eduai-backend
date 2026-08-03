import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AlertsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(status?: string) {
    const where: Record<string, string> = {};
    if (status) where.status = status;
    const alerts = await this.prisma.alert.findMany({
      where,
      include: {
        student: {
          select: {
            name: true,
            enrollments: {
              where: { status: 'APPROVED' },
              include: { class: { select: { name: true } } },
              take: 1,
            },
          },
        },
        analyses: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { diagnosis: true, teacherContent: true },
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
      className: a.student.enrollments[0]?.class.name ?? null,
      severity:
        (a.analyses[0]?.diagnosis as { severity?: string | null } | undefined)
          ?.severity ?? null,
      skillGapCount:
        (a.analyses[0]?.teacherContent as { skillGaps?: string[] } | undefined)
          ?.skillGaps?.length ?? 0,
    }));
  }

  async resolve(id: string, status: 'RESOLVED' | 'DISMISSED') {
    const alert = await this.prisma.alert.findUnique({ where: { id } });
    if (!alert) throw new NotFoundException('Alert not found');
    return this.prisma.alert.update({
      where: { id },
      data: { status },
    });
  }

  async getTeacherDetail(id: string) {
    const analysis = await this.prisma.studentAnalysis.findFirst({
      where: { alertId: id },
    });
    if (!analysis)
      throw new NotFoundException('Analysis not found for this alert');

    return {
      diagnosis: analysis.diagnosis,
      teacherContent: analysis.teacherContent,
      guardianContent: analysis.guardianContent,
      teacherFeedback: analysis.teacherFeedback,
      managementSummary: analysis.managementSummary,
    };
  }
}
