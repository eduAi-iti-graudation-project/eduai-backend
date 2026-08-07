import { Injectable, Logger, HttpStatus } from '@nestjs/common';
import pdfParse from 'pdf-parse';
import { PrismaService } from '../prisma/prisma.service';
import { GradingService } from '../grading/grading.service';
import { NotificationsService } from '../notifications/notifications.service';
import { chunkText } from './chunker';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';

@Injectable()
export class SubmissionsService {
  private readonly logger = new Logger(SubmissionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gradingService: GradingService,
    private readonly notificationService: NotificationsService,
  ) {}

  async create(
    dto: { assignmentId: string; content: string },
    studentId: string,
    organizationId: string,
  ) {
    const assignment = await this.prisma.assignment.findFirst({
      where: { id: dto.assignmentId, offering: { organizationId } },
    });
    if (!assignment) {
      throw new ApiError(
        ErrorCode.ASSIGNMENT_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This assignment could not be found.',
      );
    }
    const existing = await this.prisma.submission.findFirst({
      where: { assignmentId: dto.assignmentId, studentId },
    });
    if (existing) {
      throw new ApiError(
        ErrorCode.SUBMISSION_ALREADY_EXISTS,
        HttpStatus.CONFLICT,
        'You have already submitted this assignment.',
      );
    }
    const submission = await this.prisma.submission.create({
      data: {
        assignmentId: dto.assignmentId,
        studentId,
      },
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

  async createFromPdf(
    buffer: Buffer,
    assignmentId: string,
    studentId: string,
    organizationId: string,
  ) {
    let rawText: string;
    try {
      const pdfData = await pdfParse(buffer);
      rawText = pdfData.text;
    } catch (err) {
      throw new ApiError(
        ErrorCode.PDF_NO_TEXT,
        HttpStatus.BAD_REQUEST,
        'This PDF could not be read. Please try another file.',
        { cause: err },
      );
    }

    if (!rawText || rawText.trim().length === 0) {
      throw new ApiError(
        ErrorCode.PDF_NO_TEXT,
        HttpStatus.BAD_REQUEST,
        'This PDF contained no extractable text.',
      );
    }

    return this.create(
      { assignmentId, content: rawText },
      studentId,
      organizationId,
    );
  }

  findAll(
    status: string | undefined,
    assignmentId: string | undefined,
    organizationId: string,
  ) {
    const where: Record<string, unknown> = {
      assignment: { offering: { organizationId } },
    };
    if (status) where.status = status;
    if (assignmentId) where.assignmentId = assignmentId;
    return this.prisma.submission.findMany({
      where,
      include: { student: true, scores: { include: { criteria: true } } },
    });
  }

  findMine(studentId: string, assignmentId?: string) {
    return this.prisma.submission.findMany({
      where: {
        studentId,
        ...(assignmentId ? { assignmentId } : {}),
      },
      select: {
        id: true,
        assignmentId: true,
        status: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, organizationId: string) {
    const submission = await this.prisma.submission.findFirst({
      where: { id, assignment: { offering: { organizationId } } },
      include: {
        student: true,
        assignment: true,
        scores: { include: { criteria: true } },
        chunks: true,
      },
    });
    if (!submission) {
      throw new ApiError(
        ErrorCode.SUBMISSION_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This submission could not be found.',
      );
    }
    return submission;
  }
}
