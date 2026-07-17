import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { chunkText } from './chunker';

@Injectable()
export class SubmissionsService {
  constructor(private readonly prisma: PrismaService) {}

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
    return this.prisma.submission.findUnique({
      where: { id: submission.id },
      include: { chunks: true, scores: true },
    });
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
