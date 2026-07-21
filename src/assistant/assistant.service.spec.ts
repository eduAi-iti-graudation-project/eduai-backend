import { Test, TestingModule } from '@nestjs/testing';
import { AssistantService } from './assistant.service';
import { LlmService } from '../common/llm/llm.service';
import { MaterialsService } from '../materials/materials.service';

describe('AssistantService', () => {
  let service: AssistantService;
  let llm: Record<string, jest.Mock>;
  let materials: Record<string, jest.Mock>;

  const mockLlm = {
    generateStructured: jest.fn(),
  };

  const mockMaterials = {
    searchChunks: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssistantService,
        { provide: LlmService, useValue: mockLlm },
        { provide: MaterialsService, useValue: mockMaterials },
      ],
    }).compile();

    service = module.get<AssistantService>(AssistantService);
    llm = mockLlm;
    materials = mockMaterials;

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('chat', () => {
    const classId = '00000000-0000-0000-0000-000000000001';

    it('should respond directly without tool calls', async () => {
      llm.generateStructured.mockResolvedValue({
        action: 'respond',
        reply: 'Hello! How can I help you today?',
      });

      const result = await service.chat({
        classId,
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
        classId,
        messages: [],
        newMessage: 'Create a summary of the water cycle',
      });

      expect(result.reply).toContain('water cycle');
      expect(result.quiz).toBeUndefined();
      expect(llm.generateStructured).toHaveBeenCalledTimes(2);
      expect(materials.searchChunks).toHaveBeenCalledWith(
        classId,
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

      const result = await service.chat({
        classId,
        messages: [],
        newMessage: 'Explain quantum physics',
      });

      expect(result.reply).toContain('quantum physics');
      expect(materials.searchChunks).toHaveBeenCalled();
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
        classId,
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
        classId,
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
        classId,
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

    it('should generate quiz without prior search when no search needed', async () => {
      llm.generateStructured.mockResolvedValueOnce({
        action: 'create_quiz',
        topic: 'basic math',
        questionCount: 2,
      });

      const quizResult = {
        title: 'Basic Math Quiz',
        questions: [
          {
            type: 'mcq' as const,
            question: 'What is 2+2?',
            options: ['3', '4', '5', '6'],
            correctAnswer: '4',
          },
        ],
      };

      llm.generateStructured.mockResolvedValueOnce(quizResult);

      const result = await service.chat({
        classId,
        messages: [],
        newMessage: 'Give me a math quiz',
      });

      expect(result.reply).toContain('Basic Math Quiz');
      expect(result.quiz).toEqual(quizResult);
      expect(llm.generateStructured).toHaveBeenCalledTimes(2);
    });
  });
});
