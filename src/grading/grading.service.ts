import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AnalysisService } from '../analysis/analysis.service';

@Injectable()
export class GradingService {
  private readonly logger = new Logger(GradingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly analysisService: AnalysisService,
  ) {}

  async gradeSubmission(submissionId: string): Promise<void> {
    await this.prisma.submission.update({
      where: { id: submissionId },
      data: { status: 'GRADING_IN_PROGRESS' },
    });

    const criteria = await this.prisma.rubricCriteria.findMany({
      where: {
        rubric: { assignment: { submissions: { some: { id: submissionId } } } },
      },
    });

    for (const criterion of criteria) {
      await this.prisma.gradingScore.upsert({
        where: {
          submissionId_criteriaId: { submissionId, criteriaId: criterion.id },
        },
        create: {
          submissionId,
          criteriaId: criterion.id,
          pointsAwarded: Math.floor(criterion.maxPoints * 0.7),
          aiFeedback: 'Auto-graded placeholder. AI grading pipeline pending.',
        },
        update: {},
      });
    }

    await this.prisma.submission.update({
      where: { id: submissionId },
      data: { status: 'REVIEWED' },
    });
  }

  async confirmAll(submissionId: string) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: { scores: true },
    });
    if (!submission) throw new NotFoundException('Submission not found');

    await this.prisma.$transaction(async (tx) => {
      await tx.gradingScore.updateMany({
        where: { submissionId, isConfirmed: false },
        data: { isConfirmed: true },
      });
      await tx.submission.update({
        where: { id: submissionId },
        data: { status: 'CONFIRMED' },
      });
    });

    this.analysisService
      .evaluateStudent(submission.studentId)
      .then(() =>
        this.logger.log(
          `Analysis evaluated for student ${submission.studentId}`,
        ),
      )
      .catch((err) =>
        this.logger.error(
          `Analysis evaluation failed for student ${submission.studentId}`,
          err,
        ),
      );

    return this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: { scores: true },
    });
  }

  async confirm(
    id: string,
    dto: { pointsAwarded: number; teacherNotes?: string },
  ) {
    const score = await this.prisma.gradingScore.findUnique({ where: { id } });
    if (!score) throw new NotFoundException('GradingScore not found');
    return this.prisma.gradingScore.update({
      where: { id },
      data: {
        pointsAwarded: dto.pointsAwarded,
        teacherNotes: dto.teacherNotes,
        isConfirmed: true,
      },
    });
  }
}
