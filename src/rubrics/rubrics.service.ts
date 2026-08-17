import { Injectable, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';
import { ExtractedRubricSchema } from './dto';
import pdfParse from 'pdf-parse';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';
import { ErrorHint } from '../common/errors/hints';

@Injectable()
export class RubricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
  ) {}

  async create(
    dto: {
      title: string;
      assignmentId: string;
      criteria: { description: string; maxPoints: number }[];
    },
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
    return this.prisma.rubric.create({
      data: {
        title: dto.title,
        assignmentId: dto.assignmentId,
        criteria: { create: dto.criteria },
      },
      include: { criteria: true },
    });
  }

  findAll(assignmentId: string | undefined, organizationId: string) {
    return this.prisma.rubric.findMany({
      where: {
        ...(assignmentId ? { assignmentId } : {}),
        assignment: { offering: { organizationId } },
      },
      include: { criteria: true },
    });
  }

  async findOne(id: string, organizationId: string) {
    const rubric = await this.prisma.rubric.findFirst({
      where: { id, assignment: { offering: { organizationId } } },
      include: { criteria: true, assignment: true },
    });
    if (!rubric) {
      throw new ApiError(
        ErrorCode.RUBRIC_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This rubric could not be found.',
      );
    }
    return rubric;
  }

  async findConfirmedRubric(assignmentId: string, organizationId: string) {
    const rubric = await this.prisma.rubric.findFirst({
      where: {
        assignmentId,
        isConfirmed: true,
        assignment: { offering: { organizationId } },
      },
      include: { criteria: true },
    });
    if (!rubric) {
      throw new ApiError(
        ErrorCode.RUBRIC_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'No confirmed rubric exists for this assignment yet.',
      );
    }
    return rubric;
  }

  async findSimilarCriteria(
    embedding: number[],
    assignmentId: string,
    organizationId: string,
    limit = 50,
  ) {
    const vectorStr = `[${embedding.join(',')}]`;
    const criteria = await this.prisma.$queryRaw<
      { id: string; description: string; maxPoints: number; distance: number }[]
    >`
      SELECT rc.id, rc.description, rc."maxPoints", rc.embedding <-> ${vectorStr}::vector AS distance
      FROM rubric_criteria rc
      JOIN rubrics r ON r.id = rc."rubricId"
      JOIN assignments a ON a.id = r."assignmentId"
      JOIN course_offerings co ON co.id = a."courseOfferingId"
      WHERE r."assignmentId" = ${assignmentId}::uuid
        AND co."organizationId" = ${organizationId}::uuid
        AND r."isConfirmed" = true
        AND rc.embedding IS NOT NULL
      ORDER BY distance ASC
      LIMIT ${limit}
    `;
    if (criteria.length === 0) {
      return this.findConfirmedRubric(assignmentId, organizationId).then(
        (r) => r.criteria,
      );
    }
    return criteria;
  }

  /**
   * Creates a rubric that is immediately confirmed (approved) with embedded
   * criteria. Used by the AI assignment+rubric flow after the teacher approves
   * the generated draft — avoids a separate confirm round-trip per section.
   */
  async createConfirmed(
    dto: {
      title: string;
      assignmentId: string;
      criteria: { description: string; maxPoints: number }[];
    },
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

    const created = await this.prisma.rubric.create({
      data: {
        title: dto.title,
        assignmentId: dto.assignmentId,
        isConfirmed: true,
        criteria: { create: dto.criteria },
      },
      include: { criteria: true },
    });

    await this.embedCriteria(created.criteria);
    return created;
  }

  async confirm(id: string, organizationId: string) {
    const rubric = await this.prisma.rubric.findFirst({
      where: { id, assignment: { offering: { organizationId } } },
      include: { criteria: true },
    });
    if (!rubric) {
      throw new ApiError(
        ErrorCode.RUBRIC_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This rubric could not be found.',
      );
    }

    const updated = await this.prisma.rubric.update({
      where: { id },
      data: { isConfirmed: true },
      include: { criteria: true },
    });

    await this.embedCriteria(updated.criteria);
    return updated;
  }

  private async embedCriteria(criteria: { id: string; description: string }[]) {
    for (const criterion of criteria) {
      try {
        const embedding = await this.llm.embed(criterion.description);
        const vectorStr = `[${embedding.join(',')}]`;
        await this.prisma.$executeRawUnsafe(
          `UPDATE rubric_criteria SET embedding = $1::vector WHERE id = $2`,
          vectorStr,
          criterion.id,
        );
      } catch (err) {
        console.error(
          `[RubricsService] Failed to embed criterion ${criterion.id}:`,
          err,
        );
      }
    }
  }

  async importPdf(buffer: Buffer) {
    console.log(`[importPdf] processing PDF buffer (${buffer.length} bytes)`);

    let rawText: string;
    try {
      const pdfData = await pdfParse(buffer);
      rawText = pdfData.text;
      console.log(`[importPdf] extracted ${rawText.length} chars from PDF`);
    } catch (err) {
      console.error('[importPdf] pdf-parse failed:', err);
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

    console.log('[importPdf] calling LlmService.generateStructured...');
    try {
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

      if (!result.criteria || result.criteria.length === 0) {
        throw new ApiError(
          ErrorCode.FILE_NO_TEXT,
          HttpStatus.BAD_REQUEST,
          'We could not find grading criteria in that PDF. Please try a file that clearly lists criteria, like "Thesis — 10 points".',
        );
      }

      console.log(
        '[importPdf] LLM returned',
        JSON.stringify(result).length,
        'chars',
      );
      return result;
    } catch (err) {
      console.error('[importPdf] LLM call failed:', err);

      if (
        err instanceof Error &&
        (err.message.includes('validation') ||
          err.message.includes('Validation') ||
          err.message.includes('Empty LLM'))
      ) {
        throw new ApiError(
          ErrorCode.FILE_NO_TEXT,
          HttpStatus.BAD_REQUEST,
          'We could not extract grading criteria from that PDF. Please try a file that clearly lists criteria, like "Thesis — 10 points".',
          { hint: ErrorHint.RETRY, cause: err },
        );
      }

      throw err;
    }
  }

  async fromPdf(buffer: Buffer, assignmentId: string, organizationId: string) {
    const assignment = await this.prisma.assignment.findFirst({
      where: { id: assignmentId, offering: { organizationId } },
    });
    if (!assignment) {
      throw new ApiError(
        ErrorCode.ASSIGNMENT_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This assignment could not be found.',
      );
    }
    const extracted = await this.importPdf(buffer);
    return this.prisma.rubric.create({
      data: {
        title: extracted.title || 'Imported Rubric',
        assignmentId,
        criteria: { create: extracted.criteria },
      },
      include: { criteria: true },
    });
  }
}
