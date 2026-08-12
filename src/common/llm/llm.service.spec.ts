import { Test, TestingModule } from '@nestjs/testing';
import { LlmService } from './llm.service';
import { PiiService } from '../pii/pii.service';
import { ProviderService } from '../ai/provider.service';
import { ValidationError } from '../validation/retry-once';
import { z } from 'zod';
import { GeneratedAssignmentSchema } from '../../assignments/dto';

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

  describe('chat', () => {
    it('should redact, call the provider, and restore', async () => {
      mockRedact.mockImplementation((text: string) => ({
        redacted: text.replace('Jane Doe', '[REDACTED_0]'),
        replacements: new Map([['[REDACTED_0]', 'Jane Doe']]),
      }));
      mockRestore.mockImplementation((text: string) =>
        text.replace('[REDACTED_0]', 'Jane Doe'),
      );
      mockChat.mockResolvedValueOnce('Hello [REDACTED_0], here is help');

      const result = await service.chat('You help Jane Doe', 'Hi Jane Doe');

      expect(mockRedact).toHaveBeenCalled();
      expect(mockChat).toHaveBeenCalled();
      expect(result).toBe('Hello Jane Doe, here is help');
      expect(result).not.toContain('[REDACTED_0]');
      expect(result).toContain('Jane Doe');
    });

    it('should pass text through untouched when nothing is redacted', async () => {
      mockRedact.mockImplementation((text: string) => ({
        redacted: text,
        replacements: new Map(),
      }));
      mockRestore.mockImplementation((text: string) => text);
      mockChat.mockResolvedValueOnce('plain reply');

      const result = await service.chat('system', 'user');

      expect(result).toBe('plain reply');
      expect(mockRestore).not.toHaveBeenCalled();
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

    it('should strip raw control characters from provider JSON', async () => {
      mockChat.mockResolvedValueOnce('{"name":"line1\nline2","score":85}');

      const result = await service.generateStructured({
        systemPrompt: 'Test',
        userPrompt: 'Test',
        schema,
      });

      expect(mockChat).toHaveBeenCalledTimes(1);
      expect(result.name).toBe('line1line2');
    });

    it('should strip control chars re-injected by PII restore', async () => {
      const prevRedact = mockRedact.getMockImplementation();
      const prevRestore = mockRestore.getMockImplementation();

      mockRedact.mockImplementation((text: string) => ({
        redacted: text,
        replacements: new Map([['[REDACTED_0]', 'line1\nline2']]),
      }));
      mockRestore.mockImplementation((text: string) =>
        text.replace('[REDACTED_0]', 'line1\nline2'),
      );
      mockChat.mockResolvedValueOnce(
        JSON.stringify({ name: '[REDACTED_0]', score: 85 }),
      );

      const result = await service.generateStructured({
        systemPrompt: 'Test',
        userPrompt: 'Test',
        schema,
      });

      expect(mockRestore).toHaveBeenCalled();
      expect(result.name).toBe('line1line2');

      mockRedact.mockImplementation(prevRedact);
      mockRestore.mockImplementation(prevRestore);
    });

    it('should throw ValidationError when provider returns empty response', async () => {
      mockChat.mockResolvedValue('');

      await expect(
        service.generateStructured({
          systemPrompt: 'Test',
          userPrompt: 'Test',
          schema,
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('should retry 3 times total before succeeding on last attempt', async () => {
      mockChat
        .mockResolvedValueOnce('not json')
        .mockResolvedValueOnce('also not json')
        .mockResolvedValueOnce(JSON.stringify({ name: 'retried', score: 90 }));

      const result = await service.generateStructured({
        systemPrompt: 'Test',
        userPrompt: 'Test',
        schema,
      });

      expect(mockChat).toHaveBeenCalledTimes(3);
      expect(result).toEqual({ name: 'retried', score: 90 });
    });

    it('should retry and then fail cleanly on a malformed assignment draft (no invented fallback)', async () => {
      mockChat
        .mockResolvedValueOnce('not json')
        .mockResolvedValueOnce('also not json')
        .mockResolvedValueOnce('definitely not json');

      await expect(
        service.generateStructured({
          systemPrompt: 'Test',
          userPrompt: 'Test',
          schema: GeneratedAssignmentSchema,
        }),
      ).rejects.toThrow(ValidationError);

      expect(mockChat).toHaveBeenCalledTimes(3);
    });
  });
});
