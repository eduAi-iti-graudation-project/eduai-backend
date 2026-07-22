import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from '../reports/reports.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class AnalysisService {
  private readonly logger = new Logger(AnalysisService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reportsService: ReportsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async evaluateStudent(studentId: string): Promise<void> {
    const lastThreeConfirmed = await this.prisma.gradingScore.findMany({
      where: {
        submission: { studentId },
        isConfirmed: true,
      },
      include: { submission: true },
      orderBy: { submission: { createdAt: 'desc' } },
      take: 3,
    });

    if (lastThreeConfirmed.length < 2) return;

    const scores = lastThreeConfirmed.map((s) => s.pointsAwarded);
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const maxPoints = 10;
    const avgPct = (avg / maxPoints) * 100;

    let alertType: string | null = null;

    if (avgPct < 60) {
      alertType = 'FAILING';
    } else if (
      scores.length >= 2 &&
      scores[scores.length - 1] < scores[scores.length - 2]
    ) {
      alertType = 'DOWNWARD_TREND';
    }

    if (alertType) {
      const student = await this.prisma.user.findUnique({
        where: { id: studentId },
        include: {
          enrollments: {
            include: { class: { include: { teacher: true } } },
          },
        },
      });

      if (!student) return;

      const alert = await this.prisma.alert.create({
        data: {
          type: alertType,
          reason: `Average of last ${scores.length} confirmed scores is ${avgPct.toFixed(1)}%`,
          status: 'ACTIVE',
          studentId,
        },
      });

      this.reportsService
        .generate(studentId, alert.id)
        .then(() => {
          this.logger.log(`Report generated for alert ${alert.id}`);

          const enrollments = student.enrollments ?? [];
          const teacherIds = [
            ...new Set(enrollments.map((e) => e.class.teacherId)),
          ];

          for (const teacherId of teacherIds) {
            this.notificationsService.notifyUser(
              teacherId,
              'ALERT',
              `Student flagged: ${student.name}`,
              `${alert.type}: ${alert.reason}`,
            );
          }

          if (student.guardianId) {
            this.notificationsService.notifyUser(
              student.guardianId,
              'ALERT',
              `Alert for ${student.name}`,
              `Your child has been flagged: ${alert.type} — ${alert.reason}`,
            );
          }
        })
        .catch((err) =>
          this.logger.error(
            `Failed to generate report for alert ${alert.id}`,
            err,
          ),
        );
    }
  }
}
