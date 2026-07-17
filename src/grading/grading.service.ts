import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';
import { RubricsService } from '../rubrics/rubrics.service';
import { GradingOutput, GradingOutputSchema } from './dto';

@Injectable()
export class GradingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly rubrics: RubricsService,
  ) {}

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

  private async embedAndStoreChunk(chunkId: string, content: string) {
    const embedding = await this.llm.embed(content);
    const vectorStr = `[${embedding.join(',')}]`;
    await this.prisma.$executeRawUnsafe(
      `UPDATE submission_chunks SET embedding = $1::vector WHERE id = $2`,
      vectorStr,
      chunkId,
    );
  }
