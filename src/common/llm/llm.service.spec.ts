import { Test, TestingModule } from '@nestjs/testing';
import { LlmService } from './llm.service';
import { PiiService } from '../pii/pii.service';
import { z } from 'zod';

const mockEmbeddingsCreate = jest.fn().mockResolvedValue({
  data: [{ embedding: new Array(1536).fill(0.1) }],
});
const mockChatCreate = jest.fn().mockResolvedValue({
  choices: [
    {
      message: {
        content: JSON.stringify({ name: 'test', score: 85 }),
      },
    },
  ],
});

jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    embeddings: { create: mockEmbeddingsCreate },
    chat: { completions: { create: mockChatCreate } },
  }));
});

const mockRedact = jest.fn().mockImplementation((text: string) => ({
  redacted: text,
  replacements: new Map(),
}));
const mockRestore = jest.fn().mockImplementation((text: string) => text);

describe('LlmService', () => {
  let service: LlmService;

  beforeEach(async () => {
    mockChatCreate.mockClear();
    mockEmbeddingsCreate.mockClear();
    mockRedact.mockClear();
    mockRestore.mockClear();
    mockChatCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({ name: 'test', score: 85 }),
          },
        },
      ],
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LlmService,
        {
          provide: PiiService,
          useValue: {
            redact: mockRedact,
            restore: mockRestore,
          },
        },
      ],
    }).compile();

    service = module.get<LlmService>(LlmService);
  });

  describe('embed', () => {
    it('should return embedding vector', async () => {
      const result = await service.embed('test text');
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1536);
      expect(result[0]).toBe(0.1);
      expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: 'test text',
        dimensions: 1536,
      });
    });
  });

  describe('generateStructured', () => {
    const schema = z.object({
      name: z.string(),
      score: z.number(),
    });

    it('should call PiiService.redact before LLM call', async () => {
      const result = await service.generateStructured({
        systemPrompt: 'You are a grader',
        userPrompt: 'Grade this submission',
        schema,
      });

      expect(mockRedact).toHaveBeenCalled();
      expect(result).toEqual({ name: 'test', score: 85 });
    });

    it('should return typed result matching schema', async () => {
      const result = await service.generateStructured({
        systemPrompt: 'Test',
        userPrompt: 'Test',
        schema,
      });

      expect(result.name).toBe('test');
      expect(result.score).toBe(85);
    });
  });
});
