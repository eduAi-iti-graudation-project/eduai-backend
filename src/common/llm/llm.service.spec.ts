import { Test, TestingModule } from '@nestjs/testing';
import { LlmService } from './llm.service';
import { PiiService } from '../pii/pii.service';
import { ProviderService } from '../ai/provider.service';
import { z } from 'zod';

const mockHfEmbed = jest.fn().mockResolvedValue(new Array(1024).fill(0.1));
const mockChat = jest
  .fn()
  .mockResolvedValue(JSON.stringify({ name: 'test', score: 85 }));

const mockRedact = jest.fn().mockImplementation((text: string) => ({
  redacted: text,
  replacements: new Map(),
}));
const mockRestore = jest.fn().mockImplementation((text: string) => text);

describe('LlmService', () => {
  let service: LlmService;

  beforeEach(async () => {
    mockChat.mockClear();
    mockHfEmbed.mockClear();
    mockRedact.mockClear();
    mockRestore.mockClear();

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
        {
          provide: ProviderService,
          useValue: {
            chat: mockChat,
            hfEmbed: mockHfEmbed,
          },
        },
      ],
    }).compile();

    service = module.get<LlmService>(LlmService);
  });

  describe('embed', () => {
    it('should call hfEmbed and return vector', async () => {
      const result = await service.embed('test text');

      expect(mockHfEmbed).toHaveBeenCalledWith('test text');
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1024);
      expect(result[0]).toBe(0.1);
    });
  });

  describe('generateStructured', () => {
    const schema = z.object({
      name: z.string(),
      score: z.number(),
    });

    it('should call PiiService.redact before provider call', async () => {
      const result = await service.generateStructured({
        systemPrompt: 'You are a grader',
        userPrompt: 'Grade this submission',
        schema,
      });

      expect(mockRedact).toHaveBeenCalled();
      expect(mockChat).toHaveBeenCalled();
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
