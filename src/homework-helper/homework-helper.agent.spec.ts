import { Test, TestingModule } from '@nestjs/testing';
import { HomeworkHelperAgent } from './homework-helper.agent';
import { LlmService } from '../common/llm/llm.service';
import { ValidationError } from '../common/validation/retry-once';
import { MaterialsService } from '../materials/materials.service';
import { PrismaService } from '../prisma/prisma.service';

describe('HomeworkHelperAgent', () => {
  let agent: HomeworkHelperAgent;
  let llm: Record<string, jest.Mock>;
  let materials: Record<string, jest.Mock>;
  let prisma: Record<string, Record<string, jest.Mock>>;

  const mockLlm = { generateStructured: jest.fn() };
  const mockMaterials = { searchChunks: jest.fn() };
  const mockPrisma = {
    homeworkHelpInteraction: { create: jest.fn() },
    assignment: { findMany: jest.fn(), findFirst: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HomeworkHelperAgent,
        { provide: LlmService, useValue: mockLlm },
        { provide: MaterialsService, useValue: mockMaterials },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    agent = module.get<HomeworkHelperAgent>(HomeworkHelperAgent);
    llm = mockLlm;
    materials = mockMaterials;
    prisma = mockPrisma;
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(agent).toBeDefined();
  });

  it('should redirect to teacher when search finds no material', async () => {
    llm.generateStructured
      .mockResolvedValueOnce({
        action: 'search_curriculum',
        query: 'solar system',
        topK: 5,
      })
      .mockResolvedValueOnce({
        action: 'respond_to_student',
        answer:
          'This topic is not covered in your uploaded class material. Please ask your teacher about it.',
        responseAction: 'REDIRECT_TEACHER',
        sources: [],
      });

    materials.searchChunks.mockResolvedValue([]);
    prisma.homeworkHelpInteraction.create.mockResolvedValue({
      id: '11111111-1111-1111-1111-111111111111',
    });

    const result = await agent.help({
      courseOfferingId: '00000000-0000-0000-0000-000000000001',
      studentId: '00000000-0000-0000-0000-000000000002',
      question: 'Explain the solar system',
    });

    expect(result.action).toBe('REDIRECT_TEACHER');
    expect(result.interactionId).toBe('11111111-1111-1111-1111-111111111111');
    expect(llm.generateStructured).toHaveBeenCalledTimes(2);

    const calls = llm.generateStructured.mock.calls as Array<
      Array<{ userPrompt: string }>
    >;
    const secondPrompt = calls[1][0].userPrompt;
    expect(secondPrompt).toContain('No relevant curriculum material found');
    expect(secondPrompt).toContain('Do NOT answer from your own knowledge');
    expect(secondPrompt).toContain('REDIRECT_TEACHER');
  });

  it('should pass search results when material is found', async () => {
    llm.generateStructured
      .mockResolvedValueOnce({
        action: 'search_curriculum',
        query: 'water cycle',
        topK: 5,
      })
      .mockResolvedValueOnce({
        action: 'respond_to_student',
        answer: 'Evaporation, condensation, and precipitation.',
        responseAction: 'EXPLANATION',
        sources: ['Science Chapter 3'],
      });

    materials.searchChunks.mockResolvedValue([
      {
        id: 'c1',
        content: 'The water cycle has three main stages.',
        distance: 0.12,
        materialId: 'm1',
        materialTitle: 'Science Chapter 3',
      },
    ]);
    prisma.homeworkHelpInteraction.create.mockResolvedValue({
      id: '22222222-2222-2222-2222-222222222222',
    });

    const result = await agent.help({
      courseOfferingId: '00000000-0000-0000-0000-000000000001',
      studentId: '00000000-0000-0000-0000-000000000002',
      question: 'How does the water cycle work?',
    });

    expect(result.action).toBe('EXPLANATION');
    expect(result.sources).toEqual(['Science Chapter 3']);

    const calls = llm.generateStructured.mock.calls as Array<
      Array<{ userPrompt: string }>
    >;
    const secondPrompt = calls[1][0].userPrompt;
    expect(secondPrompt).toContain('[Result 1]');
    expect(secondPrompt).toContain('Science Chapter 3');
    expect(secondPrompt).not.toContain('Do NOT answer from your own knowledge');
  });

  it('should seed assignment details before the LLM loop when assignmentId is provided', async () => {
    llm.generateStructured.mockResolvedValueOnce({
      action: 'respond_to_student',
      answer:
        'For question 3, try setting up the equation first. Search the material on chemical reactions.',
      responseAction: 'HINT',
      sources: ['Science Chapter 3'],
    });

    prisma.assignment.findFirst.mockResolvedValue({
      id: '33333333-3333-3333-3333-333333333333',
      title: 'Math Homework 1',
      description: 'Algebra basics',
      dueDate: new Date('2026-01-15'),
      totalPoints: 10,
      rubrics: [
        {
          title: 'Correctness Rubric',
          criteria: [{ description: 'Shows all work', maxPoints: 5 }],
        },
      ],
    });
    prisma.homeworkHelpInteraction.create.mockResolvedValue({
      id: '44444444-4444-4444-4444-444444444444',
    });

    const result = await agent.help({
      courseOfferingId: '00000000-0000-0000-0000-000000000001',
      studentId: '00000000-0000-0000-0000-000000000002',
      question: "I don't get question 3",
      assignmentId: '33333333-3333-3333-3333-333333333333',
    });

    expect(result.action).toBe('HINT');
    expect(result.interactionId).toBe('44444444-4444-4444-4444-444444444444');

    const findFirstCalls = prisma.assignment.findFirst.mock.calls as Array<
      Array<{ where: { courseOfferingId?: string; id?: string } }>
    >;
    expect(findFirstCalls[0][0].where.courseOfferingId).toBe(
      '00000000-0000-0000-0000-000000000001',
    );
    expect(findFirstCalls[0][0].where.id).toBe(
      '33333333-3333-3333-3333-333333333333',
    );
    expect(prisma.assignment.findMany).not.toHaveBeenCalled();
    expect(llm.generateStructured).toHaveBeenCalledTimes(1);

    const calls = llm.generateStructured.mock.calls as Array<
      Array<{ systemPrompt: string; userPrompt: string }>
    >;
    expect(calls[0][0].systemPrompt).toContain(
      'do NOT call lookup_assignment again',
    );
    expect(calls[0][0].userPrompt).toContain('Assignment details:');
    expect(calls[0][0].userPrompt).toContain('Math Homework 1');
    expect(calls[0][0].userPrompt).toContain('Shows all work');
  });

  it('should answer deterministically without the LLM when assignmentId not found', async () => {
    prisma.assignment.findFirst.mockResolvedValue(null);
    prisma.homeworkHelpInteraction.create.mockResolvedValue({
      id: '55555555-5555-5555-5555-555555555555',
    });

    const result = await agent.help({
      courseOfferingId: '00000000-0000-0000-0000-000000000001',
      studentId: '00000000-0000-0000-0000-000000000002',
      question: 'Help with math assignment 1',
      assignmentId: '99999999-9999-9999-9999-999999999999',
    });

    expect(result.action).toBe('EXPLANATION');
    expect(result.answer).toContain("couldn't find that assignment");
    expect(result.sources).toEqual([]);
    expect(result.interactionId).toBe('55555555-5555-5555-5555-555555555555');
    expect(llm.generateStructured).not.toHaveBeenCalled();
    expect(prisma.assignment.findMany).not.toHaveBeenCalled();

    const logCalls = prisma.homeworkHelpInteraction.create.mock.calls as Array<
      Array<{ data: { action?: string; sources?: string[] } }>
    >;
    expect(logCalls[0][0].data.action).toBe('EXPLANATION');
    expect(logCalls[0][0].data.sources).toEqual([]);
  });

  it('should respond gracefully and log a REDIRECT_TEACHER interaction when the LLM call fails', async () => {
    llm.generateStructured.mockRejectedValue(
      new ValidationError(
        'Validation failed after 3 attempts: Error: Empty LLM response',
        {},
        3,
      ),
    );
    prisma.homeworkHelpInteraction.create.mockResolvedValue({
      id: '66666666-6666-6666-6666-666666666666',
    });

    const result = await agent.help({
      courseOfferingId: '00000000-0000-0000-0000-000000000001',
      studentId: '00000000-0000-0000-0000-000000000002',
      question: 'can you help me with the assignment',
    });

    expect(result.action).toBe('REDIRECT_TEACHER');
    expect(result.answer).toContain('ask your teacher');
    expect(result.sources).toEqual([]);
    expect(result.interactionId).toBe('66666666-6666-6666-6666-666666666666');

    const logCalls = prisma.homeworkHelpInteraction.create.mock.calls as Array<
      Array<{ data: { action?: string; answer?: string } }>
    >;
    expect(logCalls[0][0].data.action).toBe('REDIRECT_TEACHER');
    expect(logCalls[0][0].data.answer).toContain('ask your teacher');
    expect(llm.generateStructured).toHaveBeenCalledTimes(1);
  });

  it('should respond gracefully and log the interaction when MAX_ITERATIONS is exhausted', async () => {
    llm.generateStructured.mockResolvedValue({
      action: 'search_curriculum',
      query: 'photosynthesis',
      topK: 5,
    });
    materials.searchChunks.mockResolvedValue([
      {
        id: 'c1',
        content: 'Photosynthesis converts light into chemical energy.',
        distance: 0.1,
        materialId: 'm1',
        materialTitle: 'Science Chapter 3',
      },
    ]);
    prisma.homeworkHelpInteraction.create.mockResolvedValue({
      id: '77777777-7777-7777-7777-777777777777',
    });

    const result = await agent.help({
      courseOfferingId: '00000000-0000-0000-0000-000000000001',
      studentId: '00000000-0000-0000-0000-000000000002',
      question: 'How does photosynthesis work?',
    });

    expect(result.action).toBe('REDIRECT_TEACHER');
    expect(result.interactionId).toBe('77777777-7777-7777-7777-777777777777');
    expect(llm.generateStructured).toHaveBeenCalledTimes(5);

    const logCalls = prisma.homeworkHelpInteraction.create.mock.calls as Array<
      Array<{ data: { action?: string } }>
    >;
    expect(logCalls[0][0].data.action).toBe('REDIRECT_TEACHER');
  });
});
