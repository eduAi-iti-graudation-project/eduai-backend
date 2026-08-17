import { Injectable, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';
import { MaterialsService } from '../materials/materials.service';
import { RubricsService } from '../rubrics/rubrics.service';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';
import {
  GeneratedAssignmentSchema,
  GeneratedAssignmentWithRubricSchema,
} from './dto';

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

const GENERATE_COURSE_ASSIGNMENT_SYSTEM_PROMPT = `You are an assignment designer for an educator. Given a course scope (a unit, or the entire course), the class's curriculum material, and an optional assignment type and target point total, draft both a complete assignment and its grading rubric.

Return ONLY valid JSON matching this schema (no markdown, no prose outside the JSON):
{
  "assignment": {
    "title": "string — concise, student-facing assignment title (max 100 chars)",
    "description": "string — complete instructions for students: what to do, expected length/format, and what will be assessed (3-8 sentences)"
  },
  "rubric": {
    "title": "string — short rubric title",
    "criteria": [{ "description": "string — what is being evaluated", "maxPoints": "positive integer" }]
  }
}

Rules:
1. Base EVERYTHING only on the provided curriculum material. Never use outside knowledge.
2. The assignment must cover the ENTIRE provided scope — aim for a single comprehensive assignment that lets students demonstrate understanding across the scope.
3. criteria should have 3-6 items, specific, observable, and grade-appropriate.
4. Choose a sensible round total for the criteria's maxPoints (e.g. each criterion 20 or 25 points). The assignment is worth the sum of its criteria's maxPoints — criteria should add up to a clean total like 20, 50, or 100.
5. The assignment type is essay, short-answer, or project — shape the instructions and criteria accordingly.`;

@Injectable()
export class AssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly materials: MaterialsService,
    private readonly rubrics: RubricsService,
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

  async generateCourseDraft(
    dto: {
      courseId: string;
      assignments: { courseOfferingId: string }[];
      chapterId?: string | null;
      dueDate: string;
      assignmentType?: 'essay' | 'short_answer' | 'project';
    },
    organizationId: string,
  ) {
    const offerings = await this.prisma.courseOffering.findMany({
      where: { id: { in: dto.assignments.map((a) => a.courseOfferingId) } },
      select: { id: true, organizationId: true, courseId: true },
    });
    const validIds = new Set(
      offerings
        .filter((o) => o.organizationId === organizationId)
        .map((o) => o.id),
    );
    const invalid = dto.assignments.find(
      (a) => !validIds.has(a.courseOfferingId),
    );
    if (offerings.length !== dto.assignments.length || invalid) {
      throw new ApiError(
        ErrorCode.OFFERING_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'One or more selected sections could not be found.',
      );
    }
    if (offerings.some((o) => o.courseId !== dto.courseId)) {
      throw new ApiError(
        ErrorCode.OFFERING_NOT_FOUND,
        HttpStatus.BAD_REQUEST,
        'All selected sections must belong to the same course.',
      );
    }

    const scopeTitle = dto.chapterId
      ? await this.prisma.materialChapter.findUnique({
          where: { id: dto.chapterId },
          select: { title: true },
        })
      : null;

    const searchQuery = scopeTitle?.title ?? 'overview of the entire course';
    const chunks = await this.materials.searchChunksByCourse(
      dto.courseId,
      searchQuery,
      5,
      dto.chapterId ?? undefined,
    );

    let contextChunks = chunks;
    if (contextChunks.length === 0) {
      contextChunks = dto.chapterId
        ? await this.materials.getChunksByChapter(
            dto.courseId,
            dto.chapterId,
            50,
          )
        : await this.materials.getChunksByCourse(dto.courseId, 50);
    }

    if (contextChunks.length === 0) {
      return {
        status: 'not_grounded',
        message: `No curriculum material was found for ${
          scopeTitle ? `the unit "${scopeTitle.title}"` : 'this course'
        }, so an AI draft would not be grounded in anything real. Upload material first, or write the assignment and rubric manually.`,
      } as const;
    }

    const context = contextChunks
      .map(
        (chunk, idx) =>
          `[Chunk ${idx + 1}] (from: ${chunk.materialTitle}${
            chunk.chapterTitle ? `, chapter: ${chunk.chapterTitle}` : ''
          })\n${chunk.content}`,
      )
      .join('\n\n');

    const draft = await this.llm.generateStructured({
      systemPrompt: GENERATE_COURSE_ASSIGNMENT_SYSTEM_PROMPT,
      userPrompt: [
        `Course scope: ${scopeTitle ? `unit "${scopeTitle.title}"` : 'the entire course'}`,
        `Assignment type: ${dto.assignmentType ?? 'essay'}`,
        '',
        `Curriculum material:\n${context}`,
      ].join('\n'),
      schema: GeneratedAssignmentWithRubricSchema,
    });

    return { status: 'grounded', draft };
  }

  /**
   * Persists an approved AI-generated assignment + rubric to one or more
   * sections. Creates an Assignment and a confirmed (approved) Rubric per
   * section, so grading works everywhere with no extra approval steps.
   */
  async saveGenerated(
    dto: {
      assignments: { courseOfferingId: string }[];
      title: string;
      description?: string;
      dueDate: string;
      rubricTitle: string;
      criteria: { description: string; maxPoints: number }[];
    },
    organizationId: string,
  ) {
    const offerings = await this.prisma.courseOffering.findMany({
      where: {
        id: { in: dto.assignments.map((a) => a.courseOfferingId) },
        organizationId,
      },
      include: { section: true },
    });
    if (offerings.length !== dto.assignments.length) {
      throw new ApiError(
        ErrorCode.OFFERING_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'One or more selected sections could not be found.',
      );
    }

    const totalPoints = dto.criteria.reduce((sum, c) => sum + c.maxPoints, 0);

    const saved: {
      assignmentId: string;
      rubricId: string;
      courseOfferingId: string;
      sectionName: string;
    }[] = [];

    for (const offering of offerings) {
      const assignment = await this.prisma.assignment.create({
        data: {
          title: dto.title,
          description: dto.description ?? null,
          dueDate: new Date(dto.dueDate),
          totalPoints,
          courseOfferingId: offering.id,
        },
      });
      const rubric = await this.rubrics.createConfirmed(
        {
          title: dto.rubricTitle,
          assignmentId: assignment.id,
          criteria: dto.criteria,
        },
        organizationId,
      );
      saved.push({
        assignmentId: assignment.id,
        rubricId: rubric.id,
        courseOfferingId: offering.id,
        sectionName: offering.section.name,
      });
    }

    return saved;
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
