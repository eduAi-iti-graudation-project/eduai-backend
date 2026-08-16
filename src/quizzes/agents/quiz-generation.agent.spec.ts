import { Test, TestingModule } from '@nestjs/testing';
import { QuizGenerationAgent } from './quiz-generation.agent';
import { LlmService } from '../../common/llm/llm.service';
import { MaterialsService } from '../../materials/materials.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('QuizGenerationAgent', () => {
  let agent: QuizGenerationAgent;
  let llm: Record<string, jest.Mock>;
  let materials: Record<string, jest.Mock>;

  const mockLlm = { generateStructured: jest.fn() };
  const mockMaterials = {
    searchChunksByCourse: jest.fn(),
    getChunksByChapter: jest.fn(),
  };
  const mockPrisma = {
    quiz: { create: jest.fn(), update: jest.fn() },
    materialChapter: { findUnique: jest.fn() },
  };

  const courseId = '00000000-0000-0000-0000-000000000010';
  const teacherId = '00000000-0000-0000-0000-000000000002';
  const offeringId = '00000000-0000-0000-0000-000000000001';
  const chapterId = '00000000-0000-0000-0000-000000000009';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuizGenerationAgent,
        { provide: LlmService, useValue: mockLlm },
        { provide: MaterialsService, useValue: mockMaterials },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    agent = module.get<QuizGenerationAgent>(QuizGenerationAgent);
    llm = mockLlm;
    materials = mockMaterials;
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(agent).toBeDefined();
  });

  it('should refuse to generate quiz when the unit has no material', async () => {
    mockPrisma.materialChapter.findUnique.mockResolvedValue({
      title: 'Ancient Egypt',
    });
    llm.generateStructured.mockResolvedValueOnce({
      action: 'search_curriculum',
      query: 'ancient egypt',
      topK: 5,
    });

    materials.searchChunksByCourse.mockResolvedValue([]);
    materials.getChunksByChapter.mockResolvedValue([]);

    const result = await agent.generate({
      courseId,
      assignments: [{ courseOfferingId: offeringId }],
      teacherId,
      chapterId,
    });

    expect(result.quizId).toBe('');
    expect(result.message).toContain('Ancient Egypt');
    expect(result.message).toContain('No curriculum material');
    expect(llm.generateStructured).toHaveBeenCalledTimes(1);
    expect(materials.searchChunksByCourse).toHaveBeenCalledTimes(1);
    expect(materials.getChunksByChapter).toHaveBeenCalledWith(
      courseId,
      chapterId,
      50,
    );
  });

  it('should fall back to the unit material when the semantic search returns nothing', async () => {
    mockPrisma.materialChapter.findUnique.mockResolvedValue({
      title: 'Ancient Egypt',
    });
    llm.generateStructured
      .mockResolvedValueOnce({
        action: 'search_curriculum',
        query: 'Chapter 1',
        topK: 5,
      })
      .mockResolvedValueOnce({
        action: 'generate_questions',
        context: 'Material about ancient egypt.',
        types: ['MCQ'],
        count: 5,
        topic: 'ancient egypt',
        avoidTopics: [],
        difficulty: 'MEDIUM',
      })
      .mockResolvedValueOnce({
        questions: [
          {
            type: 'MCQ',
            question: 'Where is the Nile?',
            options: [
              { text: 'Egypt', isCorrect: true },
              { text: 'Rome', isCorrect: false },
            ],
            points: 1,
            order: 0,
            correctAnswer: 'Egypt',
            topic: 'ancient egypt',
          },
        ],
      })
      .mockResolvedValueOnce({
        action: 'save_quiz',
        title: 'Ancient Egypt Quiz',
        description: 'A quiz on ancient egypt',
        questions: [
          {
            type: 'MCQ',
            question: 'Where is the Nile?',
            options: [
              { text: 'Egypt', isCorrect: true },
              { text: 'Rome', isCorrect: false },
            ],
            points: 1,
            order: 0,
          },
        ],
      });

    materials.searchChunksByCourse.mockResolvedValue([]);
    materials.getChunksByChapter.mockResolvedValue([
      {
        id: 'chunk-1',
        materialId: 'material-1',
        materialTitle: 'Ancient Egypt',
        chapterTitle: 'Ancient Egypt',
        content: 'The Nile flows through Egypt.',
        distance: 0,
      },
    ]);
    mockPrisma.quiz.create.mockResolvedValue({
      id: 'quiz-1',
      title: 'Ancient Egypt Quiz',
    });

    const result = await agent.generate({
      courseId,
      assignments: [{ courseOfferingId: offeringId }],
      teacherId,
      chapterId,
    });

    expect(materials.searchChunksByCourse).toHaveBeenCalledWith(
      courseId,
      'Chapter 1',
      5,
      chapterId,
    );
    expect(materials.getChunksByChapter).toHaveBeenCalledWith(
      courseId,
      chapterId,
      50,
    );
    expect(result.quizId).toBe('quiz-1');
  });

  it('should refuse when the selected unit no longer exists', async () => {
    mockPrisma.materialChapter.findUnique.mockResolvedValue(null);

    const result = await agent.generate({
      courseId,
      assignments: [{ courseOfferingId: offeringId }],
      teacherId,
      chapterId,
    });

    expect(result.quizId).toBe('');
    expect(result.message).toContain('no longer exists');
    expect(llm.generateStructured).not.toHaveBeenCalled();
  });

  it('should default difficulty to MEDIUM in the initial prompt', async () => {
    mockPrisma.materialChapter.findUnique.mockResolvedValue({
      title: 'Ancient Egypt',
    });
    let capturedPrompt = '';
    llm.generateStructured.mockImplementation(
      (args: { userPrompt: string }) => {
        capturedPrompt = args.userPrompt;
        return {
          action: 'search_curriculum',
          query: 'ancient egypt',
          topK: 5,
        };
      },
    );

    materials.searchChunksByCourse.mockResolvedValue([]);
    materials.getChunksByChapter.mockResolvedValue([]);

    await agent.generate({
      courseId,
      assignments: [{ courseOfferingId: offeringId }],
      teacherId,
      chapterId,
    });

    expect(capturedPrompt).toContain('Difficulty: MEDIUM');
    expect(capturedPrompt).toContain('Unit: Ancient Egypt');
  });

  it('should forward the requested difficulty into the initial prompt', async () => {
    mockPrisma.materialChapter.findUnique.mockResolvedValue({
      title: 'Ancient Egypt',
    });
    let capturedPrompt = '';
    llm.generateStructured.mockImplementation(
      (args: { userPrompt: string }) => {
        capturedPrompt = args.userPrompt;
        return {
          action: 'search_curriculum',
          query: 'ancient egypt',
          topK: 5,
        };
      },
    );

    materials.searchChunksByCourse.mockResolvedValue([]);
    materials.getChunksByChapter.mockResolvedValue([]);

    await agent.generate({
      courseId,
      assignments: [{ courseOfferingId: offeringId }],
      teacherId,
      chapterId,
      difficulty: 'HARD',
    });

    expect(capturedPrompt).toContain('Difficulty: HARD');
  });

  it('should save the quiz with assignments when the agent finishes', async () => {
    mockPrisma.materialChapter.findUnique.mockResolvedValue({
      title: 'Ancient Egypt',
    });
    llm.generateStructured
      .mockResolvedValueOnce({
        action: 'search_curriculum',
        query: 'ancient egypt',
        topK: 5,
      })
      .mockResolvedValueOnce({
        action: 'generate_questions',
        context: 'Material about ancient egypt.',
        types: ['MCQ', 'SHORT_ANSWER'],
        count: 5,
        topic: 'ancient egypt',
        avoidTopics: [],
        difficulty: 'MEDIUM',
      })
      .mockResolvedValueOnce({
        questions: [
          {
            type: 'MCQ',
            question: 'Where is the Nile?',
            options: [
              { text: 'Egypt', isCorrect: true },
              { text: 'Rome', isCorrect: false },
            ],
            points: 1,
            order: 0,
            correctAnswer: 'Egypt',
            topic: 'ancient egypt',
          },
        ],
      })
      .mockResolvedValueOnce({
        action: 'save_quiz',
        title: 'Ancient Egypt Quiz',
        description: 'A quiz on ancient egypt',
        questions: [
          {
            type: 'MCQ',
            question: 'Where is the Nile?',
            options: [
              { text: 'Egypt', isCorrect: true },
              { text: 'Rome', isCorrect: false },
            ],
            points: 1,
            order: 0,
          },
        ],
      });

    materials.searchChunksByCourse.mockResolvedValue([
      {
        id: 'chunk-1',
        materialId: 'material-1',
        materialTitle: 'Ancient Egypt',
        chapterTitle: null,
        content: 'The Nile flows through Egypt.',
        distance: 0.2,
      },
    ]);

    mockPrisma.quiz.create.mockResolvedValue({
      id: 'quiz-1',
      title: 'Ancient Egypt Quiz',
    });

    const result = await agent.generate({
      courseId,
      assignments: [{ courseOfferingId: offeringId }],
      teacherId,
      chapterId,
      timeLimit: 15,
      endsAt: '2026-08-01T00:00:00.000Z',
    });

    expect(result.quizId).toBe('quiz-1');
    expect(materials.searchChunksByCourse).toHaveBeenCalledWith(
      courseId,
      'ancient egypt',
      5,
      chapterId,
    );
    expect(mockPrisma.quiz.create).toHaveBeenCalledWith({
      data: {
        title: 'Ancient Egypt Quiz',
        description: 'A quiz on ancient egypt',
        teacherId,
        status: 'DRAFT',
        difficulty: 'MEDIUM',
        source: 'AI',
        timeLimit: 15,
        endsAt: new Date('2026-08-01T00:00:00.000Z'),
        assignments: {
          create: [{ courseOfferingId: offeringId, targetStudentIds: [] }],
        },
        questions: {
          create: [
            {
              type: 'MCQ',
              question: 'Where is the Nile?',
              options: [
                { text: 'Egypt', isCorrect: true },
                { text: 'Rome', isCorrect: false },
              ],
              points: 1,
              order: 0,
            },
          ],
        },
      },
    });
  });

  it('should persist timeLimit and endsAt on the saved quiz', async () => {
    mockPrisma.materialChapter.findUnique.mockResolvedValue({
      title: 'Ancient Egypt',
    });
    llm.generateStructured
      .mockResolvedValueOnce({
        action: 'search_curriculum',
        query: 'ancient egypt',
        topK: 5,
      })
      .mockResolvedValueOnce({
        action: 'generate_questions',
        context: 'Material about ancient egypt.',
        types: ['MCQ'],
        count: 3,
        topic: 'ancient egypt',
        avoidTopics: [],
        difficulty: 'MEDIUM',
      })
      .mockResolvedValueOnce({
        questions: [
          {
            type: 'MCQ',
            question: 'Where is the Nile?',
            options: [
              { text: 'Egypt', isCorrect: true },
              { text: 'Rome', isCorrect: false },
            ],
            points: 1,
            order: 0,
            correctAnswer: 'Egypt',
            topic: 'ancient egypt',
          },
        ],
      })
      .mockResolvedValueOnce({
        action: 'save_quiz',
        title: 'Ancient Egypt Quiz',
        description: null,
        questions: [
          {
            type: 'MCQ',
            question: 'Where is the Nile?',
            options: [
              { text: 'Egypt', isCorrect: true },
              { text: 'Rome', isCorrect: false },
            ],
            points: 1,
            order: 0,
          },
        ],
      });

    materials.searchChunksByCourse.mockResolvedValue([
      {
        id: 'chunk-1',
        materialId: 'material-1',
        materialTitle: 'Ancient Egypt',
        chapterTitle: null,
        content: 'The Nile flows through Egypt.',
        distance: 0.2,
      },
    ]);

    mockPrisma.quiz.create.mockResolvedValue({
      id: 'quiz-1',
      title: 'Ancient Egypt Quiz',
    });

    await agent.generate({
      courseId,
      assignments: [{ courseOfferingId: offeringId }],
      teacherId,
      chapterId,
      timeLimit: 20,
      endsAt: '2026-08-01T00:00:00.000Z',
    });

    const createCall = mockPrisma.quiz.create.mock.calls[0] as [
      { data: { timeLimit: number; endsAt: Date; difficulty: string } },
    ];
    expect(createCall[0].data.timeLimit).toBe(20);
    expect(createCall[0].data.endsAt).toEqual(
      new Date('2026-08-01T00:00:00.000Z'),
    );
    expect(createCall[0].data.difficulty).toBe('MEDIUM');
    expect(mockPrisma.quiz.update).not.toHaveBeenCalled();
  });

  it('should emit the onStep sequence as each agent tool runs', async () => {
    mockPrisma.materialChapter.findUnique.mockResolvedValue({
      title: 'Ancient Egypt',
    });
    llm.generateStructured
      .mockResolvedValueOnce({
        action: 'search_curriculum',
        query: 'ancient egypt',
        topK: 5,
      })
      .mockResolvedValueOnce({
        action: 'generate_questions',
        context: 'Material about ancient egypt.',
        types: ['MCQ'],
        count: 5,
        topic: 'ancient egypt',
        avoidTopics: [],
        difficulty: 'MEDIUM',
      })
      .mockResolvedValueOnce({
        questions: [
          {
            type: 'MCQ',
            question: 'Where is the Nile?',
            options: [
              { text: 'Egypt', isCorrect: true },
              { text: 'Rome', isCorrect: false },
            ],
            points: 1,
            order: 0,
            correctAnswer: 'Egypt',
            topic: 'ancient egypt',
          },
        ],
      })
      .mockResolvedValueOnce({
        action: 'review_questions',
        questions: [
          {
            type: 'MCQ',
            question: 'Where is the Nile?',
            topic: 'ancient egypt',
          },
        ],
        context: 'Material about ancient egypt.',
      })
      .mockResolvedValueOnce({
        coverage: 'Nile and pyramids',
        gaps: [],
        balanced: true,
      })
      .mockResolvedValueOnce({
        action: 'save_quiz',
        title: 'Ancient Egypt Quiz',
        description: 'A quiz on ancient egypt',
        questions: [
          {
            type: 'MCQ',
            question: 'Where is the Nile?',
            options: [
              { text: 'Egypt', isCorrect: true },
              { text: 'Rome', isCorrect: false },
            ],
            points: 1,
            order: 0,
          },
        ],
      });

    materials.searchChunksByCourse.mockResolvedValue([
      {
        id: 'chunk-1',
        materialId: 'material-1',
        materialTitle: 'Ancient Egypt',
        chapterTitle: null,
        content: 'The Nile flows through Egypt.',
        distance: 0.2,
      },
    ]);
    mockPrisma.quiz.create.mockResolvedValue({
      id: 'quiz-1',
      title: 'Ancient Egypt Quiz',
    });

    const onStep = jest.fn();
    const result = await agent.generate(
      {
        courseId,
        assignments: [{ courseOfferingId: offeringId }],
        teacherId,
        chapterId,
      },
      onStep,
    );

    expect(result.quizId).toBe('quiz-1');
    expect(onStep).toHaveBeenCalledTimes(5);
    expect(onStep.mock.calls.flat()).toEqual([
      'thinking',
      'search_curriculum',
      'generate_questions',
      'review_questions',
      'save_quiz',
    ]);
  });
});
