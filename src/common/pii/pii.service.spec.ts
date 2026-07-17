import { Test, TestingModule } from '@nestjs/testing';
import { PiiService } from './pii.service';

describe('PiiService', () => {
  let service: PiiService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PiiService],
    }).compile();

    service = module.get<PiiService>(PiiService);
  });

  describe('redact', () => {
    it('should redact email addresses', () => {
      const text = 'Contact john.doe@example.com for details';
      const result = service.redact(text);
      expect(result.redacted).not.toContain('john.doe@example.com');
      expect(result.redacted).toContain('[REDACTED_');
    });

    it('should redact UUIDs', () => {
      const text = 'User 550e8400-e29b-41d4-a716-446655440000 submitted';
      const result = service.redact(text);
      expect(result.redacted).not.toContain(
        '550e8400-e29b-41d4-a716-446655440000',
      );
    });

    it('should redact full names', () => {
      const text = 'Student Alice Johnson submitted their work';
      const result = service.redact(text);
      expect(result.redacted).not.toContain('Alice Johnson');
    });

    it('should preserve text with no PII', () => {
      const text = 'This is a generic text without personal information';
      const result = service.redact(text);
      expect(result.redacted).toBe(text);
      expect(result.replacements.size).toBe(0);
    });

    it('should return replacements map', () => {
      const text = 'Email: test@test.com, Name: John Doe';
      const result = service.redact(text);
      expect(result.replacements.size).toBeGreaterThan(0);
      for (const [placeholder, original] of result.replacements) {
        expect(placeholder).toMatch(/^\[REDACTED_\d+\]$/);
        expect(typeof original).toBe('string');
      }
    });
  });

  describe('restore', () => {
    it('should restore original values from placeholders', () => {
      const text = 'Contact [REDACTED_0] for details';
      const replacements = new Map([['[REDACTED_0]', 'john@example.com']]);
      const result = service.restore(text, replacements);
      expect(result).toBe('Contact john@example.com for details');
    });

    it('should restore multiple values', () => {
      const text = '[REDACTED_0] sent email to [REDACTED_1]';
      const replacements = new Map([
        ['[REDACTED_0]', 'Alice'],
        ['[REDACTED_1]', 'bob@test.com'],
      ]);
      const result = service.restore(text, replacements);
      expect(result).toBe('Alice sent email to bob@test.com');
    });
  });
});
