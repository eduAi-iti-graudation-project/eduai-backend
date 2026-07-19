import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';
import { shouldFlagStudent } from './threshold';
import { ExplanationSchema } from './dto';

@Injectable()
export class AnalysisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
  ) {}

  async evaluateStudent(studentId: string): Promise<void> {
    const scores = await this.prisma.gradingScore.findMany({
      where: {
        submission: { studentId },
        isConfirmed: true,
      },
      include: {
        criteria: true,
        submission: { include: { assignment: true } },
      },
    });

    if (scores.length === 0) return;

    const grouped = this.groupBySubmission(scores);
    const percentages = grouped.map(
      (g) => (g.totalAwarded / g.totalPossible) * 100,
    );

    const result = shouldFlagStudent(percentages);
    if (!result.flagged) return;

    const existingAlerts = await this.prisma.alert.count({
      where: { studentId, status: 'ACTIVE' },
    });

    const alertType = existingAlerts > 0 ? 'CONSISTENT_STRUGGLE' : result.type;

    const explanation = await this.llm.generateStructured({
      systemPrompt:
        'You are an academic advisor. Given a student recent grade history, write exactly one paragraph explaining why the student was flagged. Be specific and constructive.',
      userPrompt: `Student flagged as ${alertType}. Recent submission percentages: ${percentages.join(', ')}%`,
      schema: ExplanationSchema,
    });

    await this.prisma.alert.create({
      data: {
        studentId,
        type: alertType,
        reason: explanation.reason,
        status: 'ACTIVE',
      },
    });
  }

  private groupBySubmission(
    scores: {
      pointsAwarded: number;
      criteria: { maxPoints: number };
      submissionId: string;
    }[],
  ) {
    const map = new Map<
      string,
      { totalAwarded: number; totalPossible: number }
    >();
    for (const s of scores) {
      const entry = map.get(s.submissionId) ?? {
        totalAwarded: 0,
        totalPossible: 0,
      };
      entry.totalAwarded += s.pointsAwarded;
      entry.totalPossible += s.criteria.maxPoints;
      map.set(s.submissionId, entry);
    }
    return Array.from(map.values());
  }
}
