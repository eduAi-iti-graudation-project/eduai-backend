import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  createWriteFeedbackTool,
  type FeedbackTool,
} from './tools/write-feedback.tool';

@Injectable()
export class FeedbackWriterService {
  private readonly logger = new Logger(FeedbackWriterService.name);
  private readonly writeFeedbackTool: FeedbackTool;

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService,
    private readonly notificationsService: NotificationsService,
  ) {
    this.writeFeedbackTool = createWriteFeedbackTool(
      this.llmService,
    ) as unknown as FeedbackTool;
  }

  async write(submissionId: string): Promise<void> {
    const scores = await this.prisma.gradingScore.findMany({
      where: { submissionId },
      include: { criteria: true },
    });

    if (scores.length === 0) {
      this.logger.warn(
        `No grading scores found for submission ${submissionId}`,
      );
      return;
    }

    const chunks = await this.prisma.submissionChunk.findMany({
      where: { submissionId },
    });

    const submissionContent = chunks.map((c) => c.content).join('\n');
    let writtenCount = 0;

    for (const score of scores) {
      try {
        const result = await this.writeFeedbackTool.execute({
          criterionDescription: score.criteria.description,
          maxPoints: score.criteria.maxPoints,
          pointsAwarded: score.pointsAwarded,
          submissionContent,
        });

        await this.prisma.gradingScore.update({
          where: { id: score.id },
          data: { aiFeedback: result.feedback },
        });
        writtenCount++;
      } catch (err) {
        this.logger.error(
          `Failed to write feedback for score ${score.id}`,
          err,
        );
      }
    }

    if (writtenCount > 0) {
      const submission = await this.prisma.submission.findUnique({
        where: { id: submissionId },
      });
      if (submission) {
        this.notificationsService
          .notifyUser(
            submission.studentId,
            'FEEDBACK_READY',
            'Your assignment feedback is ready',
            `AI feedback has been generated for your submission. View it in your grades.`,
          )
          .catch((err) =>
            this.logger.error(
              `Failed to notify student for ${submissionId}`,
              err,
            ),
          );
      }
    }

    this.logger.log(
      `Feedback written for ${writtenCount}/${scores.length} criteria on submission ${submissionId}`,
    );
  }
}
