import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CommunicationAgentService } from '../communication-agent/communication-agent.service';

@Injectable()
export class GradingService {
  private readonly logger = new Logger(GradingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly communicationAgentService: CommunicationAgentService,
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
      data: { status: 'REVIEW_READY' },
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

    this.communicationAgentService
      .analyze(submissionId)
      .then(() =>
        this.logger.log(
          `Communication agent analysis complete for submission ${submissionId}`,
        ),
      )
      .catch((err) =>
        this.logger.error(
          `Communication agent analysis failed for submission ${submissionId}`,
          err,
        ),
      );

    return this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: { scores: true },
    });
  }
}
