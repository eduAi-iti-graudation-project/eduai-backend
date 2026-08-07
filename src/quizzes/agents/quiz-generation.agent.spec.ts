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
  const mockMaterials = { searchChunks: jest.fn() };
  const mockPrisma = {
    quiz: { create: jest.fn() },
  };

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

  it('should refuse to generate quiz when search finds no material', async () => {
    llm.generateStructured.mockResolvedValueOnce({
      action: 'search_curriculum',
      query: 'ancient egypt',
      topK: 5,
    });

    materials.searchChunks.mockResolvedValue([]);

    const result = await agent.generate({
      courseOfferingId: '00000000-0000-0000-0000-000000000001',
      teacherId: '00000000-0000-0000-0000-000000000002',
      topic: 'ancient egypt',
    });

    expect(result.quizId).toBe('');
    expect(result.message).toContain('ancient egypt');
    expect(result.message).toContain('No curriculum material');
    expect(llm.generateStructured).toHaveBeenCalledTimes(1);
    expect(materials.searchChunks).toHaveBeenCalledTimes(1);
  });

  it('should default difficulty to MEDIUM in the initial prompt', async () => {
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

    materials.searchChunks.mockResolvedValue([]);

    await agent.generate({
      courseOfferingId: '00000000-0000-0000-0000-000000000001',
      teacherId: '00000000-0000-0000-0000-000000000002',
      topic: 'ancient egypt',
    });

    expect(capturedPrompt).toContain('Difficulty: MEDIUM');
  });

  it('should forward the requested difficulty into the initial prompt', async () => {
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

    materials.searchChunks.mockResolvedValue([]);

    await agent.generate({
      courseOfferingId: '00000000-0000-0000-0000-000000000001',
      teacherId: '00000000-0000-0000-0000-000000000002',
      topic: 'ancient egypt',
      difficulty: 'HARD',
    });

    expect(capturedPrompt).toContain('Difficulty: HARD');
  });
});
