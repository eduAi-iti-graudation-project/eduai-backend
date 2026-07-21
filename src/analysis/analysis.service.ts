import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from '../reports/reports.service';

@Injectable()
export class AnalysisService {
  private readonly logger = new Logger(AnalysisService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reportsService: ReportsService,
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
        .then(() => this.logger.log(`Report generated for alert ${alert.id}`))
        .catch((err) =>
          this.logger.error(
            `Failed to generate report for alert ${alert.id}`,
            err,
          ),
        );
    }
  }
}
