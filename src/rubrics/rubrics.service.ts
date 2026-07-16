import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';
import { ExtractedRubricSchema } from './dto';

@Injectable()
export class RubricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
  ) {}

  create(dto: {
    title: string;
    assignmentId: string;
    criteria: { description: string; maxPoints: number }[];
  }) {
    return this.prisma.rubric.create({
      data: {
        title: dto.title,
        assignmentId: dto.assignmentId,
        criteria: { create: dto.criteria },
      },
      include: { criteria: true },
    });
  }

  findAll(assignmentId?: string) {
    return assignmentId
      ? this.prisma.rubric.findMany({
          where: { assignmentId },
          include: { criteria: true },
        })
      : this.prisma.rubric.findMany({ include: { criteria: true } });
  }

  async findOne(id: string) {
    const rubric = await this.prisma.rubric.findUnique({
      where: { id },
      include: { criteria: true, assignment: true },
    });
    if (!rubric) throw new NotFoundException('Rubric not found');
    return rubric;
  }

  async confirm(id: string) {
    const rubric = await this.prisma.rubric.findUnique({ where: { id } });
    if (!rubric) throw new NotFoundException('Rubric not found');
    return this.prisma.rubric.update({
      where: { id },
      data: { isConfirmed: true },
      include: { criteria: true },
    });
  }

  async importPdf(buffer: Buffer) {
    const pdfParse = require('pdf-parse');
    const pdfData = await pdfParse(buffer);
    const rawText = pdfData.text;

    const result = await this.llm.generateStructured({
      systemPrompt: `You are a rubric extraction assistant. Extract grading criteria from the provided rubric document.

For each criterion, determine:
- description: A clear description of what is being evaluated
- maxPoints: The maximum possible points for this criterion

Also infer a title for the rubric if possible.

Return valid JSON matching this schema:
{
  "title": "string (optional)",
  "criteria": [{ "description": "string", "maxPoints": "number (positive integer)" }]
}`,
      userPrompt: `Extract all grading criteria from this rubric text:\n\n${rawText}`,
      schema: ExtractedRubricSchema,
    });

    return result;
  }
}
