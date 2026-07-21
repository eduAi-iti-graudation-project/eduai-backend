import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GradingService } from '../grading/grading.service';
import { NotificationsService } from '../notifications/notifications.service';
import { chunkText } from './chunker';

@Injectable()
export class SubmissionsService {
  private readonly logger = new Logger(SubmissionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gradingService: GradingService,
    private readonly notificationService: NotificationsService,
  ) {}

  async create(dto: { assignmentId: string; content: string }) {
    const submission = await this.prisma.submission.create({
      data: { assignmentId: dto.assignmentId, studentId: '' },
    });
    const chunks = chunkText(dto.content);
    if (chunks.length > 0) {
      await this.prisma.submissionChunk.createMany({
        data: chunks.map((content) => ({
          submissionId: submission.id,
          content,
        })),
      });
    }

    this.gradingService
      .gradeSubmission(submission.id)
      .then(() =>
        this.notificationService.notifyTeacher(submission, 'GRADING_READY'),
      )
      .catch((err) => this.logger.error('Grading failed', err));

    return {
      id: submission.id,
      status: submission.status,
      assignmentId: submission.assignmentId,
    };
  }

  findAll(status?: string, assignmentId?: string) {
    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (assignmentId) where.assignmentId = assignmentId;
    return this.prisma.submission.findMany({
      where,
      include: { student: true, scores: { include: { criteria: true } } },
    });
  }

  async findOne(id: string) {
    const submission = await this.prisma.submission.findUnique({
      where: { id },
      include: {
        student: true,
        assignment: true,
        scores: { include: { criteria: true } },
        chunks: true,
      },
    });
    if (!submission) throw new NotFoundException('Submission not found');
    return submission;
  }
}
