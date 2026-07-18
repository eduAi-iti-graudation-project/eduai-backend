import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { chunkText } from './chunker';
import pdfParse from 'pdf-parse';

@Injectable()
export class SubmissionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: { assignmentId: string; content: string }) {
    const submission = await this.prisma.submission.create({
      data: { assignmentId: dto.assignmentId, studentId: '00000000-0000-0000-0000-000000000000' },
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

  async createFromPdf(buffer: Buffer, assignmentId: string) {
    let rawText: string;
    try {
      const pdfData = await pdfParse(buffer);
      rawText = pdfData.text;
    } catch (err) {
      throw new BadRequestException(
        `Failed to parse PDF: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!rawText || rawText.trim().length === 0) {
      throw new BadRequestException('PDF contained no extractable text');
    }

    return this.create({ assignmentId, content: rawText });
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
