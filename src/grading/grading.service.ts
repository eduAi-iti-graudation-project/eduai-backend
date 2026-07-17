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

  private async callGradingLlm(
    chunkContent: string,
    criteria: { id: string; description: string; maxPoints: number }[],
  ): Promise<GradingOutput> {
    return this.llm.generateStructured({
      systemPrompt: `You are a grading assistant evaluating student work against a rubric.
Grade each criterion independently. Assign a score based solely on the
provided rubric criteria — do not invent new criteria. For each criterion
you MUST output:
- criterionId: the ID from the rubric criteria list
- pointsAwarded: integer between 0 and maxPoints
- feedback: specific explanation of why points were awarded or deducted

Output valid JSON matching the schema.`,
      userPrompt: `Rubric criteria:\n${JSON.stringify(criteria.map(c => ({ id: c.id, description: c.description, maxPoints: c.maxPoints })))}\n\nStudent submission chunk:\n${chunkContent}`,
      schema: GradingOutputSchema,
    });
  }
