import { Test, TestingModule } from '@nestjs/testing';
import { z } from 'zod';
import { AssignmentsService } from './assignments.service';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';
import { MaterialsService } from '../materials/materials.service';
import { RubricsService } from '../rubrics/rubrics.service';
import { ValidationError } from '../common/validation/retry-once';
import {
  GeneratedAssignmentSchema,
  GenerateAssignmentResultSchema,
  GenerateCourseAssignmentResultSchema,
  GeneratedAssignmentWithRubricSchema,
  SaveGeneratedAssignmentsSchema,
} from './dto';

type GeneratedDraft = z.infer<typeof GeneratedAssignmentSchema>;
type GeneratedCourseDraft = z.infer<typeof GeneratedAssignmentWithRubricSchema>;

describe('AssignmentsService.generateDraft', () => {
  let service: AssignmentsService;

  const organizationId = 'org-1';

  const mockPrisma = {
    courseOffering: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    assignment: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    rubric: {
      create: jest.fn(),
    },
    materialChapter: {
      findUnique: jest.fn(),
    },
  };

  const mockLlm = {
    generateStructured: jest.fn<
      Promise<GeneratedDraft>,
      [
        {
          systemPrompt: string;
          userPrompt: string;
          schema: typeof GeneratedAssignmentSchema;
        },
      ]
    >(),
    embed: jest.fn(),
  };

  const mockMaterials = {
    searchChunksByCourse: jest.fn(),
    searchChunks: jest.fn(),
  };

  const mockRubrics = {
    createConfirmed: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssignmentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LlmService, useValue: mockLlm },
        { provide: MaterialsService, useValue: mockMaterials },
        { provide: RubricsService, useValue: mockRubrics },
      ],
    }).compile();

    service = module.get<AssignmentsService>(AssignmentsService);
    jest.clearAllMocks();
  });

  const dto = {
    courseOfferingId: 'offering-1',
    topic: 'Photosynthesis',
    assignmentType: 'essay' as const,
    targetPoints: 100,
  };

  const offering = {
    id: 'offering-1',
    courseId: 'course-1',
    organizationId,
  };

  const chunk = {
    id: 'chunk-1',
    content: 'Photosynthesis converts light energy into chemical energy.',
    distance: 0.12,
    materialId: 'material-1',
    materialTitle: 'Biology Chapter 4',
  };

  it('returns not_grounded and never calls the LLM when no curriculum material matches', async () => {
    mockPrisma.courseOffering.findFirst.mockResolvedValue(offering);
    mockMaterials.searchChunksByCourse.mockResolvedValue([]);

    const result = await service.generateDraft(dto, organizationId);

    expect(mockPrisma.courseOffering.findFirst).toHaveBeenCalledWith({
      where: { id: dto.courseOfferingId, organizationId },
    });
    expect(mockMaterials.searchChunksByCourse).toHaveBeenCalledWith(
      offering.courseId,
      dto.topic,
      5,
    );
    expect(mockLlm.generateStructured).not.toHaveBeenCalled();
    expect(mockPrisma.assignment.create).not.toHaveBeenCalled();
    expect(result.status).toBe('not_grounded');
    expect(result.message).toContain('No matching curriculum material');
    GenerateAssignmentResultSchema.parse(result);
  });

  it('returns a grounded draft validated against the Zod schema when material matches', async () => {
    mockPrisma.courseOffering.findFirst.mockResolvedValue(offering);
    mockMaterials.searchChunksByCourse.mockResolvedValue([chunk]);

    const draft: GeneratedDraft = {
      title: 'Photosynthesis Essay',
      description:
        'Write an essay explaining photosynthesis, covering light reactions and the Calvin cycle.',
      criteria: [
        {
          description: 'Accurate description of light reactions',
          maxPoints: 40,
        },
        {
          description: 'Accurate description of the Calvin cycle',
          maxPoints: 40,
        },
        { description: 'Clarity and organization', maxPoints: 20 },
      ],
    };
    mockLlm.generateStructured.mockResolvedValue(draft);

    const result = await service.generateDraft(dto, organizationId);

    expect(mockLlm.generateStructured).toHaveBeenCalledTimes(1);
    const call = mockLlm.generateStructured.mock.calls[0]?.[0];
    expect(call?.schema).toBe(GeneratedAssignmentSchema);
    expect(call?.userPrompt).toContain('Assignment type: essay');
    expect(call?.userPrompt).toContain(dto.topic);
    expect(call?.userPrompt).toContain('Target point total: 100');
    expect(call?.userPrompt).toContain(chunk.content);

    expect(result).toEqual({ status: 'grounded', draft });
    GenerateAssignmentResultSchema.parse(result);
    expect(GeneratedAssignmentSchema.parse(result.draft)).toEqual(draft);
  });

  it('fails cleanly on a malformed LLM response without inventing fallback content', async () => {
    mockPrisma.courseOffering.findFirst.mockResolvedValue(offering);
    mockMaterials.searchChunksByCourse.mockResolvedValue([chunk]);

    const error = new ValidationError(
      'Schema validation failed after retry: invalid',
      { first: new Error('a'), second: new Error('b') },
      3,
    );
    mockLlm.generateStructured.mockRejectedValue(error);

    await expect(service.generateDraft(dto, organizationId)).rejects.toThrow(
      ValidationError,
    );
    expect(mockPrisma.assignment.create).not.toHaveBeenCalled();
    expect(mockPrisma.rubric.create).not.toHaveBeenCalled();
  });

  it('throws OFFERING_NOT_FOUND for an unknown offering', async () => {
    mockPrisma.courseOffering.findFirst.mockResolvedValue(null);

    await expect(
      service.generateDraft(dto, organizationId),
    ).rejects.toMatchObject({ code: 'OFFERING_NOT_FOUND' });
    expect(mockMaterials.searchChunksByCourse).not.toHaveBeenCalled();
    expect(mockLlm.generateStructured).not.toHaveBeenCalled();
  });
});

describe('AssignmentsService.generateCourseDraft', () => {
  let service: AssignmentsService;

  const organizationId = 'org-1';

  const mockPrisma = {
    courseOffering: {
      findMany: jest.fn(),
    },
    materialChapter: {
      findUnique: jest.fn(),
    },
    assignment: {
      create: jest.fn(),
    },
  };

  const mockLlm = {
    generateStructured: jest.fn<
      Promise<GeneratedCourseDraft>,
      [
        {
          systemPrompt: string;
          userPrompt: string;
          schema: typeof GeneratedAssignmentWithRubricSchema;
        },
      ]
    >(),
    embed: jest.fn(),
  };

  const mockMaterials = {
    searchChunksByCourse: jest.fn(),
    getChunksByChapter: jest.fn(),
    getChunksByCourse: jest.fn(),
    searchChunks: jest.fn(),
  };

  const mockRubrics = {
    createConfirmed: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssignmentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LlmService, useValue: mockLlm },
        { provide: MaterialsService, useValue: mockMaterials },
        { provide: RubricsService, useValue: mockRubrics },
      ],
    }).compile();

    service = module.get<AssignmentsService>(AssignmentsService);
    jest.clearAllMocks();
  });

  const chunk = {
    id: 'chunk-1',
    content: 'Photosynthesis converts light energy into chemical energy.',
    distance: 0.12,
    materialId: 'material-1',
    materialTitle: 'Biology Chapter 4',
    chapterTitle: null,
  };

  const courseDraft = {
    assignment: {
      title: 'Photosynthesis Comprehensive Essay',
      description: 'Explain photosynthesis across the unit.',
    },
    rubric: {
      title: 'Photosynthesis Rubric',
      criteria: [
        { description: 'Light reactions', maxPoints: 50 },
        { description: 'Calvin cycle', maxPoints: 50 },
      ],
    },
  };

  const courseDto = {
    courseId: 'course-1',
    assignments: [{ courseOfferingId: 'offering-1' }],
    dueDate: '2026-06-30T23:59:00.000Z',
    assignmentType: 'essay' as const,
    targetPoints: 100,
  };

  it('grounds on the entire course when no unit is selected and no search results match', async () => {
    mockPrisma.courseOffering.findMany.mockResolvedValue([
      { id: 'offering-1', organizationId, courseId: 'course-1' },
    ]);
    mockPrisma.materialChapter.findUnique.mockResolvedValue(null);
    mockMaterials.searchChunksByCourse.mockResolvedValue([]);
    mockMaterials.getChunksByCourse.mockResolvedValue([chunk]);
    mockLlm.generateStructured.mockResolvedValue(courseDraft);

    const result = await service.generateCourseDraft(courseDto, organizationId);

    expect(mockMaterials.searchChunksByCourse).toHaveBeenCalledWith(
      'course-1',
      'overview of the entire course',
      5,
      undefined,
    );
    expect(mockMaterials.getChunksByCourse).toHaveBeenCalledWith(
      'course-1',
      50,
    );
    const call = mockLlm.generateStructured.mock.calls[0]?.[0];
    expect(call?.schema).toBe(GeneratedAssignmentWithRubricSchema);
    expect(call?.userPrompt).toContain('the entire course');
    expect(call?.userPrompt).toContain(chunk.content);
    expect(result).toEqual({ status: 'grounded', draft: courseDraft });
    GenerateCourseAssignmentResultSchema.parse(result);
  });

  it('grounds on a unit and falls back to the unit chunks', async () => {
    mockPrisma.courseOffering.findMany.mockResolvedValue([
      { id: 'offering-1', organizationId, courseId: 'course-1' },
    ]);
    mockPrisma.materialChapter.findUnique.mockResolvedValue({
      title: 'Photosynthesis',
    });
    mockMaterials.searchChunksByCourse.mockResolvedValue([]);
    mockMaterials.getChunksByChapter.mockResolvedValue([chunk]);
    mockLlm.generateStructured.mockResolvedValue(courseDraft);

    const result = await service.generateCourseDraft(
      { ...courseDto, chapterId: 'unit-1' },
      organizationId,
    );

    expect(mockPrisma.materialChapter.findUnique).toHaveBeenCalledWith({
      where: { id: 'unit-1' },
      select: { title: true },
    });
    expect(mockMaterials.getChunksByChapter).toHaveBeenCalledWith(
      'course-1',
      'unit-1',
      50,
    );
    const call = mockLlm.generateStructured.mock.calls[0]?.[0];
    expect(call?.userPrompt).toContain('unit "Photosynthesis"');
    expect(result.status).toBe('grounded');
  });

  it('returns not_grounded when the scope has no curriculum material', async () => {
    mockPrisma.courseOffering.findMany.mockResolvedValue([
      { id: 'offering-1', organizationId, courseId: 'course-1' },
    ]);
    mockPrisma.materialChapter.findUnique.mockResolvedValue(null);
    mockMaterials.searchChunksByCourse.mockResolvedValue([]);
    mockMaterials.getChunksByCourse.mockResolvedValue([]);

    const result = await service.generateCourseDraft(courseDto, organizationId);

    expect(mockLlm.generateStructured).not.toHaveBeenCalled();
    expect(mockPrisma.assignment.create).not.toHaveBeenCalled();
    expect(result.status).toBe('not_grounded');
  });

  it('throws OFFERING_NOT_FOUND when a section is not in the teacher organization', async () => {
    mockPrisma.courseOffering.findMany.mockResolvedValue([
      { id: 'offering-1', organizationId: 'other-org', courseId: 'course-1' },
    ]);

    await expect(
      service.generateCourseDraft(courseDto, organizationId),
    ).rejects.toMatchObject({ code: 'OFFERING_NOT_FOUND' });
    expect(mockLlm.generateStructured).not.toHaveBeenCalled();
  });

  it('rejects sections that belong to a different course', async () => {
    mockPrisma.courseOffering.findMany.mockResolvedValue([
      { id: 'offering-1', organizationId, courseId: 'course-other' },
    ]);

    await expect(
      service.generateCourseDraft(courseDto, organizationId),
    ).rejects.toMatchObject({ code: 'OFFERING_NOT_FOUND' });
  });
});

describe('AssignmentsService.saveGenerated', () => {
  let service: AssignmentsService;

  const organizationId = 'org-1';

  const mockPrisma = {
    courseOffering: {
      findMany: jest.fn(),
    },
    assignment: {
      create: jest.fn(),
    },
  };

  const mockLlm = {
    generateStructured: jest.fn<
      Promise<GeneratedCourseDraft>,
      [
        {
          systemPrompt: string;
          userPrompt: string;
          schema: typeof GeneratedAssignmentWithRubricSchema;
        },
      ]
    >(),
    embed: jest.fn(),
  };

  const mockMaterials = {
    searchChunksByCourse: jest.fn(),
    searchChunks: jest.fn(),
  };

  const mockRubrics = {
    createConfirmed: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssignmentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LlmService, useValue: mockLlm },
        { provide: MaterialsService, useValue: mockMaterials },
        { provide: RubricsService, useValue: mockRubrics },
      ],
    }).compile();

    service = module.get<AssignmentsService>(AssignmentsService);
    jest.clearAllMocks();
  });

  const saveDto = {
    assignments: [
      { courseOfferingId: '00000000-0000-4000-8000-000000000000' },
      { courseOfferingId: '00000000-0000-4000-8000-000000000001' },
    ],
    title: 'Photosynthesis Essay',
    description: 'Write an essay on photosynthesis.',
    dueDate: '2026-06-30T23:59:00.000Z',
    rubricTitle: 'Photosynthesis Rubric',
    criteria: [
      { description: 'Light reactions', maxPoints: 40 },
      { description: 'Calvin cycle', maxPoints: 40 },
      { description: 'Clarity', maxPoints: 20 },
    ],
  };

  it('creates an assignment + confirmed rubric per section with summed total points', async () => {
    mockPrisma.courseOffering.findMany.mockResolvedValue([
      {
        id: '00000000-0000-4000-8000-000000000000',
        section: { name: 'Section A' },
      },
      {
        id: '00000000-0000-4000-8000-000000000001',
        section: { name: 'Section B' },
      },
    ]);
    mockPrisma.assignment.create
      .mockResolvedValueOnce({ id: 'assignment-1' })
      .mockResolvedValueOnce({ id: 'assignment-2' });
    mockRubrics.createConfirmed
      .mockResolvedValueOnce({ id: 'rubric-1' })
      .mockResolvedValueOnce({ id: 'rubric-2' });

    const result = await service.saveGenerated(saveDto, organizationId);

    expect(mockPrisma.courseOffering.findMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: [
            '00000000-0000-4000-8000-000000000000',
            '00000000-0000-4000-8000-000000000001',
          ],
        },
        organizationId,
      },
      include: { section: true },
    });
    expect(mockPrisma.assignment.create).toHaveBeenNthCalledWith(1, {
      data: {
        title: saveDto.title,
        description: saveDto.description,
        dueDate: new Date(saveDto.dueDate),
        totalPoints: 100,
        courseOfferingId: '00000000-0000-4000-8000-000000000000',
      },
    });
    expect(mockRubrics.createConfirmed).toHaveBeenNthCalledWith(
      1,
      {
        title: saveDto.rubricTitle,
        assignmentId: 'assignment-1',
        criteria: saveDto.criteria,
      },
      organizationId,
    );
    expect(result).toEqual([
      {
        assignmentId: 'assignment-1',
        rubricId: 'rubric-1',
        courseOfferingId: '00000000-0000-4000-8000-000000000000',
        sectionName: 'Section A',
      },
      {
        assignmentId: 'assignment-2',
        rubricId: 'rubric-2',
        courseOfferingId: '00000000-0000-4000-8000-000000000001',
        sectionName: 'Section B',
      },
    ]);
    SaveGeneratedAssignmentsSchema.parse(saveDto);
  });

  it('throws OFFERING_NOT_FOUND when a section is missing', async () => {
    mockPrisma.courseOffering.findMany.mockResolvedValue([
      {
        id: '00000000-0000-4000-8000-000000000000',
        section: { name: 'Section A' },
      },
    ]);

    await expect(
      service.saveGenerated(saveDto, organizationId),
    ).rejects.toMatchObject({ code: 'OFFERING_NOT_FOUND' });
    expect(mockPrisma.assignment.create).not.toHaveBeenCalled();
  });
});
