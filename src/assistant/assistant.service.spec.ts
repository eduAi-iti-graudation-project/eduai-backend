import { Test, TestingModule } from '@nestjs/testing';
import { AssistantService } from './assistant.service';
import { LlmService } from '../common/llm/llm.service';
import { MaterialsService } from '../materials/materials.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AssistantService', () => {
  let service: AssistantService;
  let llm: Record<string, jest.Mock>;
  let materials: Record<string, jest.Mock>;

  const mockLlm = {
    generateStructured: jest.fn(),
  };

  const mockMaterials = {
    searchChunks: jest.fn(),
    getChunksByOffering: jest.fn(),
  };

  const mockPrisma = {
    courseOffering: { findUnique: jest.fn() },
    quiz: { create: jest.fn() },
    gradingScore: { findMany: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssistantService,
        { provide: LlmService, useValue: mockLlm },
        { provide: MaterialsService, useValue: mockMaterials },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AssistantService>(AssistantService);
    llm = mockLlm;
    materials = mockMaterials;

    jest.clearAllMocks();
    materials.getChunksByOffering.mockResolvedValue([]);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('chat', () => {
    const courseOfferingId = '00000000-0000-0000-0000-000000000001';

    it('should respond directly without tool calls', async () => {
      llm.generateStructured.mockResolvedValue({
        action: 'respond',
        reply: 'Hello! How can I help you today?',
      });

      const result = await service.chat({
        courseOfferingId,
        messages: [],
        newMessage: 'Hello!',
      });

      expect(result.reply).toBe('Hello! How can I help you today?');
      expect(result.quiz).toBeUndefined();
      expect(llm.generateStructured).toHaveBeenCalledTimes(1);
    });

    it('should search curriculum and respond with results', async () => {
      llm.generateStructured
        .mockResolvedValueOnce({
          action: 'search_curriculum',
          query: 'water cycle',
          topK: 3,
        })
        .mockResolvedValueOnce({
          action: 'respond',
          reply:
            'Based on the curriculum, the water cycle consists of evaporation, condensation, and precipitation.',
        });

      materials.searchChunks.mockResolvedValue([
        {
          id: 'c1',
          content:
            'The water cycle describes how water evaporates from the surface.',
          distance: 0.12,
          materialId: 'm1',
          materialTitle: 'Science Chapter 3',
        },
      ]);

      const result = await service.chat({
        courseOfferingId,
        messages: [],
        newMessage: 'Create a summary of the water cycle',
      });

      expect(result.reply).toContain('water cycle');
      expect(result.quiz).toBeUndefined();
      expect(llm.generateStructured).toHaveBeenCalledTimes(2);
      expect(materials.searchChunks).toHaveBeenCalledWith(
        courseOfferingId,
        'water cycle',
        3,
      );
    });

    it('should handle no search results gracefully', async () => {
      llm.generateStructured
        .mockResolvedValueOnce({
          action: 'search_curriculum',
          query: 'quantum physics',
        })
        .mockResolvedValueOnce({
          action: 'respond',
          reply:
            'I could not find relevant curriculum material on quantum physics.',
        });

      materials.searchChunks.mockResolvedValue([]);
      materials.getChunksByOffering.mockResolvedValue([]);

      const result = await service.chat({
        courseOfferingId,
        messages: [],
        newMessage: 'Explain quantum physics',
      });

      expect(result.reply).toContain('quantum physics');
      expect(materials.searchChunks).toHaveBeenCalled();
      expect(materials.getChunksByOffering).toHaveBeenCalledWith(
        courseOfferingId,
        50,
      );
    });

    it('should fall back to the class raw chunks when the semantic search is empty', async () => {
      llm.generateStructured
        .mockResolvedValueOnce({
          action: 'search_curriculum',
          query: 'summarize the course material',
        })
        .mockResolvedValueOnce({
          action: 'summarize_lesson',
          topic: 'the whole course',
        });

      materials.searchChunks.mockResolvedValue([]);
      materials.getChunksByOffering.mockResolvedValue([
        {
          id: 'c1',
          content:
            'Chapter 1: Cell Biology — the cell is the basic unit of all living organisms.',
          distance: 0,
          materialId: 'm1',
          materialTitle: 'science301-cell-biology',
        },
        {
          id: 'c2',
          content:
            'The plasma membrane is a phospholipid bilayer with embedded proteins.',
          distance: 0,
          materialId: 'm1',
          materialTitle: 'science301-cell-biology',
        },
      ]);

      llm.generateStructured.mockResolvedValueOnce({
        title: 'Cell Biology Overview',
        summary:
          'The uploaded material covers cell theory, organelles, membranes and microscopy.',
        keyPoints: [
          'The cell is the basic unit of life.',
          'Eukaryotic cells contain membrane-bound organelles.',
        ],
      });

      const result = await service.chat({
        courseOfferingId,
        messages: [],
        newMessage: 'Summarize the course material',
      });

      expect(result.reply).toContain('Cell Biology Overview');
      expect(materials.searchChunks).toHaveBeenCalledWith(
        courseOfferingId,
        'summarize the course material',
        5,
      );
      expect(materials.getChunksByOffering).toHaveBeenCalledWith(
        courseOfferingId,
        50,
      );
      expect(llm.generateStructured).toHaveBeenCalledTimes(3);
    });

    it('should stop after max iterations and return fallback', async () => {
      for (let i = 0; i < 5; i++) {
        llm.generateStructured.mockResolvedValueOnce({
          action: 'search_curriculum',
          query: `query ${i}`,
        });
        materials.searchChunks.mockResolvedValue([]);
      }

      const result = await service.chat({
        courseOfferingId,
        messages: [],
        newMessage: 'Do something',
      });

      expect(result.reply).toContain('unable to complete');
      expect(result.quiz).toBeUndefined();
      expect(llm.generateStructured).toHaveBeenCalledTimes(5);
    });

    it('should include conversation history', async () => {
      llm.generateStructured.mockResolvedValue({
        action: 'respond',
        reply: 'Following up on your previous question about algebra.',
      });

      const result = await service.chat({
        courseOfferingId,
        messages: [
          { role: 'user', content: 'What is algebra?' },
          { role: 'assistant', content: 'Algebra is a branch of mathematics.' },
        ],
        newMessage: 'Can you give me an example?',
      });

      expect(result.reply).toContain('algebra');
    });

    it('should generate structured quiz via create_quiz tool after search', async () => {
      llm.generateStructured
        .mockResolvedValueOnce({
          action: 'search_curriculum',
          query: 'photosynthesis',
        })
        .mockResolvedValueOnce({
          action: 'create_quiz',
          topic: 'photosynthesis',
          questionCount: 3,
          types: ['mcq', 'short_answer'],
        });

      materials.searchChunks.mockResolvedValue([
        {
          id: 'c1',
          content: 'Photosynthesis converts sunlight into chemical energy.',
          distance: 0.1,
          materialId: 'm1',
          materialTitle: 'Biology Chapter 4',
        },
      ]);

      const quizResult = {
        title: 'Photosynthesis Quiz',
        questions: [
          {
            type: 'mcq' as const,
            question: 'What gas do plants absorb during photosynthesis?',
            options: ['Oxygen', 'Carbon dioxide', 'Nitrogen', 'Hydrogen'],
            correctAnswer: 'Carbon dioxide',
          },
          {
            type: 'short_answer' as const,
            question: 'What is the primary pigment involved in photosynthesis?',
            correctAnswer: 'Chlorophyll',
          },
        ],
      };

      // Third call is the quiz generation
      llm.generateStructured.mockResolvedValueOnce(quizResult);

      const result = await service.chat({
        courseOfferingId,
        messages: [],
        newMessage: 'Create a quiz about photosynthesis',
      });

      expect(result.reply).toContain('Photosynthesis Quiz');
      expect(result.reply).toContain('Carbon dioxide');
      expect(result.reply).toContain('Chlorophyll');
      expect(result.reply).toContain('(MCQ)');
      expect(result.reply).toContain('(Short Answer)');
      expect(result.quiz).toEqual(quizResult);
      expect(llm.generateStructured).toHaveBeenCalledTimes(3);
    });

    it('should refuse to generate quiz when search found no material', async () => {
      llm.generateStructured
        .mockResolvedValueOnce({
          action: 'search_curriculum',
          query: 'quantum mechanics',
        })
        .mockResolvedValueOnce({
          action: 'create_quiz',
          topic: 'quantum mechanics',
          questionCount: 3,
          types: ['mcq', 'short_answer'],
        });

      materials.searchChunks.mockResolvedValue([]);

      const result = await service.chat({
        courseOfferingId,
        messages: [],
        newMessage: 'Create a quiz about quantum mechanics',
      });

      expect(result.reply).toContain('not covered');
      expect(result.quiz).toBeUndefined();
      expect(llm.generateStructured).toHaveBeenCalledTimes(2);
    });

    it('should refuse to generate quiz without any search context', async () => {
      llm.generateStructured.mockResolvedValueOnce({
        action: 'create_quiz',
        topic: 'basic math',
        questionCount: 2,
      });

      const result = await service.chat({
        courseOfferingId,
        messages: [],
        newMessage: 'Give me a math quiz',
      });

      expect(result.reply).toContain('not covered');
      expect(result.quiz).toBeUndefined();
      expect(llm.generateStructured).toHaveBeenCalledTimes(1);
      expect(materials.searchChunks).not.toHaveBeenCalled();
    });

    it('should persist the generated quiz as a draft when the class exists', async () => {
      llm.generateStructured
        .mockResolvedValueOnce({
          action: 'search_curriculum',
          query: 'photosynthesis',
        })
        .mockResolvedValueOnce({
          action: 'create_quiz',
          topic: 'photosynthesis',
          questionCount: 2,
        })
        .mockResolvedValueOnce({
          title: 'Photosynthesis Quiz',
          questions: [
            {
              type: 'mcq' as const,
              question: 'Which gas is absorbed?',
              options: ['Oxygen', 'Carbon dioxide', 'Nitrogen', 'Hydrogen'],
              correctAnswer: 'Carbon dioxide',
            },
            {
              type: 'short_answer' as const,
              question: 'Name the main pigment.',
              correctAnswer: 'Chlorophyll',
            },
          ],
        });

      materials.searchChunks.mockResolvedValue([
        {
          id: 'c1',
          content: 'Photosynthesis converts sunlight into chemical energy.',
          distance: 0.1,
          materialId: 'm1',
          materialTitle: 'Biology Chapter 4',
        },
      ]);
      mockPrisma.courseOffering.findUnique.mockResolvedValue({
        teacherId: 'teacher-1',
      });
      mockPrisma.quiz.create.mockResolvedValue({
        id: 'quiz-1',
        title: 'Photosynthesis Quiz',
      });

      const result = await service.chat({
        courseOfferingId,
        messages: [],
        newMessage: 'Create a quiz about photosynthesis',
      });

      expect(result.savedQuiz).toEqual({
        quizId: 'quiz-1',
        title: 'Photosynthesis Quiz',
        questionCount: 2,
      });
      expect(result.reply).toContain('quiz-1');
      expect(mockPrisma.courseOffering.findUnique).toHaveBeenCalledWith({
        where: { id: courseOfferingId },
        select: { teacherId: true },
      });
      const quizCreateMock = mockPrisma.quiz.create as any as jest.Mock<
        Promise<{ id: string; title: string }>,
        [
          {
            data: {
              teacherId: string;
              status: string;
              questions: { create: unknown[] };
            };
          },
        ]
      >;
      const saved = quizCreateMock.mock.calls[0][0];
      expect(saved.data.teacherId).toBe('teacher-1');
      expect(saved.data.status).toBe('DRAFT');
      expect(saved.data.questions.create).toHaveLength(2);
      expect(saved.data.questions.create[0]).toEqual(
        expect.objectContaining({
          type: 'MCQ',
          options: [
            { text: 'Oxygen', isCorrect: false },
            { text: 'Carbon dioxide', isCorrect: true },
            { text: 'Nitrogen', isCorrect: false },
            { text: 'Hydrogen', isCorrect: false },
          ],
        }),
      );
      expect(saved.data.questions.create[1]).toEqual({
        type: 'SHORT_ANSWER',
        question: 'Name the main pigment.',
        options: undefined,
        points: 1,
        order: 1,
      });
    });

    it('should draft a rubric and return formatted text plus structured data', async () => {
      llm.generateStructured.mockResolvedValueOnce({
        action: 'draft_rubric',
        topic: 'persuasive essay',
      });
      llm.generateStructured.mockResolvedValueOnce({
        title: 'Persuasive Essay Rubric',
        criteria: [
          { description: 'Thesis clarity', maxPoints: 5 },
          { description: 'Use of evidence', maxPoints: 5 },
        ],
      });

      const result = await service.chat({
        courseOfferingId,
        messages: [],
        newMessage: 'Draft a rubric for the persuasive essay',
      });

      expect(result.rubric).toEqual({
        title: 'Persuasive Essay Rubric',
        criteria: [
          { description: 'Thesis clarity', maxPoints: 5 },
          { description: 'Use of evidence', maxPoints: 5 },
        ],
      });
      expect(result.reply).toContain('Thesis clarity (5 pts)');
      expect(result.reply).toContain('Total: 10 pts');
    });

    it('should summarize a lesson from search context', async () => {
      llm.generateStructured
        .mockResolvedValueOnce({
          action: 'search_curriculum',
          query: 'the water cycle',
        })
        .mockResolvedValueOnce({
          action: 'summarize_lesson',
          topic: 'the water cycle',
        })
        .mockResolvedValueOnce({
          title: 'The Water Cycle',
          summary: 'Water moves between the atmosphere, land, and ocean.',
          keyPoints: ['Evaporation', 'Condensation', 'Precipitation'],
        });

      materials.searchChunks.mockResolvedValue([
        {
          id: 'c1',
          content: 'The water cycle describes evaporation and condensation.',
          distance: 0.1,
          materialId: 'm1',
          materialTitle: 'Science Chapter 3',
        },
      ]);

      const result = await service.chat({
        courseOfferingId,
        messages: [],
        newMessage: 'Summarize the water cycle lesson',
      });

      expect(result.lesson).toEqual(
        expect.objectContaining({ title: 'The Water Cycle' }),
      );
      expect(result.reply).toContain('Key points:');
      expect(result.reply).toContain('- Evaporation');
    });

    it('should refuse to summarize without curriculum material', async () => {
      llm.generateStructured
        .mockResolvedValueOnce({
          action: 'search_curriculum',
          query: 'algebra',
        })
        .mockResolvedValueOnce({
          action: 'summarize_lesson',
          topic: 'algebra',
        });

      materials.searchChunks.mockResolvedValue([]);

      const result = await service.chat({
        courseOfferingId,
        messages: [],
        newMessage: 'Summarize the algebra lesson',
      });

      expect(result.reply).toContain('no curriculum material');
      expect(result.lesson).toBeUndefined();
    });

    it('should append the strict JSON-only output rule to structured sub-prompts', async () => {
      llm.generateStructured
        .mockResolvedValueOnce({
          action: 'search_curriculum',
          query: 'the water cycle',
        })
        .mockResolvedValueOnce({
          action: 'summarize_lesson',
          topic: 'the water cycle',
        })
        .mockResolvedValueOnce({
          title: 'The Water Cycle',
          summary: 'Water moves between the atmosphere, land, and ocean.',
          keyPoints: ['Evaporation', 'Condensation', 'Precipitation'],
        });

      materials.searchChunks.mockResolvedValue([
        {
          id: 'c1',
          content: 'The water cycle describes evaporation and condensation.',
          distance: 0.1,
          materialId: 'm1',
          materialTitle: 'Science Chapter 3',
        },
      ]);

      await service.chat({
        courseOfferingId,
        messages: [],
        newMessage: 'Summarize the water cycle lesson',
      });

      const genMock = llm.generateStructured as any as jest.Mock<
        Promise<Record<string, unknown>>,
        [{ systemPrompt: string; userPrompt: string }]
      >;
      const summarizeCall = genMock.mock.calls[2];
      const systemPrompt = summarizeCall[0].systemPrompt;

      expect(systemPrompt).toContain('ONLY a single valid JSON object');
      expect(systemPrompt).toContain('"keyPoints"');
      expect(systemPrompt).toContain('Expected JSON schema:');
    });

    it('should return a graceful reply instead of throwing when a structured sub-call fails', async () => {
      llm.generateStructured
        .mockResolvedValueOnce({
          action: 'search_curriculum',
          query: 'the water cycle',
        })
        .mockResolvedValueOnce({
          action: 'summarize_lesson',
          topic: 'the water cycle',
        })
        .mockRejectedValueOnce(new Error('Validation failed after retry'));

      materials.searchChunks.mockResolvedValue([
        {
          id: 'c1',
          content: 'The water cycle describes evaporation and condensation.',
          distance: 0.1,
          materialId: 'm1',
          materialTitle: 'Science Chapter 3',
        },
      ]);

      const result = await service.chat({
        courseOfferingId,
        messages: [],
        newMessage: 'Summarize the water cycle lesson',
      });

      expect(result.reply).toContain('hit a snag');
      expect(result.lesson).toBeUndefined();
    });

    it('should plan a lesson from search context', async () => {
      llm.generateStructured
        .mockResolvedValueOnce({
          action: 'search_curriculum',
          query: 'plant cells',
        })
        .mockResolvedValueOnce({
          action: 'plan_lesson',
          topic: 'plant cells',
        })
        .mockResolvedValueOnce({
          title: 'Plant Cells',
          objectives: ['Describe cell wall function'],
          activities: ['Label a plant cell diagram'],
          assessmentHint: 'Exit ticket quiz',
        });

      materials.searchChunks.mockResolvedValue([
        {
          id: 'c1',
          content: 'Plant cells have cell walls and chloroplasts.',
          distance: 0.2,
          materialId: 'm1',
          materialTitle: 'Biology Chapter 2',
        },
      ]);

      const result = await service.chat({
        courseOfferingId,
        messages: [],
        newMessage: 'Plan a lesson on plant cells',
      });

      expect(result.lesson).toEqual(
        expect.objectContaining({ title: 'Plant Cells' }),
      );
      expect(result.reply).toContain('Objectives:');
    });

    it('should answer class analytics from real grade data', async () => {
      mockPrisma.gradingScore.findMany.mockResolvedValue([
        {
          pointsAwarded: 40,
          criteria: { maxPoints: 100, description: 'Overall' },
          submission: {
            id: 'sub-1',
            createdAt: new Date('2026-01-01'),
            student: { id: 'student-1', name: 'Sam Learner' },
          },
        },
        {
          pointsAwarded: 80,
          criteria: { maxPoints: 100, description: 'Overall' },
          submission: {
            id: 'sub-2',
            createdAt: new Date('2026-01-02'),
            student: { id: 'student-2', name: 'Alex Student' },
          },
        },
      ]);
      llm.generateStructured
        .mockResolvedValueOnce({
          action: 'class_analytics',
          question: 'How is the class doing?',
        })
        .mockResolvedValueOnce({
          overall: 'The class average is 60 with two students assessed.',
          strugglingAreas: ['Below 60% mastery'],
          recommendations: ['Offset targeted support'],
        });

      const result = await service.chat({
        courseOfferingId,
        messages: [],
        newMessage: 'How is the class doing?',
      });

      expect(result.analytics).toEqual(
        expect.objectContaining({
          recommendations: ['Offset targeted support'],
        }),
      );
      expect(result.reply).toContain('Class analytics');
      const genMock = llm.generateStructured as any as jest.Mock<
        Promise<Record<string, unknown>>,
        [{ userPrompt: string }]
      >;
      const callArg = genMock.mock.calls[1][0];
      expect(callArg.userPrompt).toContain('"classAvgPct":60');
    });

    it('should draft an assignment', async () => {
      llm.generateStructured.mockResolvedValueOnce({
        action: 'draft_assignment',
        topic: 'ecosystems report',
      });
      llm.generateStructured.mockResolvedValueOnce({
        title: 'Ecosystems Report',
        description: 'Research a local ecosystem.',
        instructions: 'Pick an ecosystem\nDescribe its producers and consumers',
      });

      const result = await service.chat({
        courseOfferingId,
        messages: [],
        newMessage: 'Draft an assignment on ecosystems',
      });

      expect(result.assignment).toEqual(
        expect.objectContaining({ title: 'Ecosystems Report' }),
      );
      expect(result.reply).toContain('Describe its producers and consumers');
    });
  });
});
