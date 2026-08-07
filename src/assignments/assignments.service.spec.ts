import { Test, TestingModule } from '@nestjs/testing';
import { z } from 'zod';
import { AssignmentsService } from './assignments.service';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';
import { MaterialsService } from '../materials/materials.service';
import { ValidationError } from '../common/validation/retry-once';
import {
  GeneratedAssignmentSchema,
  GenerateAssignmentResultSchema,
} from './dto';

type GeneratedDraft = z.infer<typeof GeneratedAssignmentSchema>;

describe('AssignmentsService.generateDraft', () => {
  let service: AssignmentsService;

  const organizationId = 'org-1';

  const mockPrisma = {
    courseOffering: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssignmentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LlmService, useValue: mockLlm },
        { provide: MaterialsService, useValue: mockMaterials },
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
