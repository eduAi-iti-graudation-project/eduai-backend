import { Injectable, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';
import { MaterialsService } from '../materials/materials.service';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';
import { GeneratedAssignmentSchema } from './dto';

const GENERATE_ASSIGNMENT_SYSTEM_PROMPT = `You are an assignment designer for an educator. Given a topic, an assignment type, an optional target point total, and the class's curriculum material, draft both the assignment and its grading rubric.

Return valid JSON matching this schema:
{
  "title": "string — concise, student-facing assignment title (max 100 chars)",
  "description": "string — complete instructions for students: what to do, expected length/format, and what will be assessed (3-8 sentences)",
  "criteria": [{ "description": "string — what is being evaluated", "maxPoints": "positive integer" }]
}

Rules:
1. Base EVERYTHING only on the provided curriculum material. Never use outside knowledge.
2. criteria should have 3-6 items, specific, observable, and grade-appropriate.
3. If a target point total is provided, the criteria's maxPoints must sum exactly to it.
4. The assignment type is essay, short-answer, or project — shape the instructions and criteria accordingly.`;

@Injectable()
export class AssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly materials: MaterialsService,
  ) {}

  async create(dto: {
    title: string;
    description?: string;
    dueDate: string;
    totalPoints: number;
    courseOfferingId: string;
  }) {
    const offering = await this.prisma.courseOffering.findUnique({
      where: { id: dto.courseOfferingId },
    });
    if (!offering) {
      throw new ApiError(
        ErrorCode.OFFERING_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This class could not be found.',
      );
    }
    return this.prisma.assignment.create({
      data: { ...dto, dueDate: new Date(dto.dueDate) },
    });
  }

  async generateDraft(
    dto: {
      courseOfferingId: string;
      topic: string;
      assignmentType: 'essay' | 'short_answer' | 'project';
      targetPoints?: number;
    },
    organizationId: string,
  ) {
    const offering = await this.prisma.courseOffering.findFirst({
      where: { id: dto.courseOfferingId, organizationId },
    });
    if (!offering) {
      throw new ApiError(
        ErrorCode.OFFERING_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This class could not be found.',
      );
    }

    const chunks = await this.materials.searchChunksByCourse(
      offering.courseId,
      dto.topic,
      5,
    );

    if (chunks.length === 0) {
      return {
        status: 'not_grounded',
        message: `No matching curriculum material was found for "${dto.topic}" in this course's uploaded materials, so an AI draft would not be grounded in anything real. Upload material covering this topic first, or write the assignment and rubric manually.`,
      } as const;
    }

    const context = chunks
      .map(
        (chunk, idx) =>
          `[Chunk ${idx + 1}] (from: ${chunk.materialTitle}, relevance: ${chunk.distance.toFixed(4)})\n${chunk.content}`,
      )
      .join('\n\n');

    const draft = await this.llm.generateStructured({
      systemPrompt: GENERATE_ASSIGNMENT_SYSTEM_PROMPT,
      userPrompt: `Assignment type: ${dto.assignmentType}\nTopic: ${dto.topic}${
        dto.targetPoints ? `\nTarget point total: ${dto.targetPoints}` : ''
      }\n\nCurriculum material:\n${context}`,
      schema: GeneratedAssignmentSchema,
    });

    return { status: 'grounded', draft };
  }

  findAll(courseOfferingId?: string) {
    return courseOfferingId
      ? this.prisma.assignment.findMany({ where: { courseOfferingId } })
      : this.prisma.assignment.findMany();
  }

  async findOne(id: string) {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id },
      include: {
        offering: {
          include: { course: true, section: true, teacher: true },
        },
        rubrics: { include: { criteria: true } },
      },
    });
    if (!assignment) {
      throw new ApiError(
        ErrorCode.ASSIGNMENT_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This assignment could not be found.',
      );
    }
    return assignment;
  }

  async update(
    id: string,
    dto: {
      title?: string;
      description?: string;
      dueDate?: string;
      totalPoints?: number;
    },
  ) {
    const existing = await this.prisma.assignment.findUnique({ where: { id } });
    if (!existing) {
      throw new ApiError(
        ErrorCode.ASSIGNMENT_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This assignment could not be found.',
      );
    }
    return this.prisma.assignment.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.dueDate !== undefined && { dueDate: new Date(dto.dueDate) }),
        ...(dto.totalPoints !== undefined && { totalPoints: dto.totalPoints }),
      },
    });
  }

  async remove(id: string) {
    const existing = await this.prisma.assignment.findUnique({ where: { id } });
    if (!existing) {
      throw new ApiError(
        ErrorCode.ASSIGNMENT_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This assignment could not be found.',
      );
    }
    return this.prisma.assignment.delete({ where: { id } });
  }
}
