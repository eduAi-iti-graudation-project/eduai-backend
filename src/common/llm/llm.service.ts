import { Injectable } from '@nestjs/common';
import { ZodSchema } from 'zod';
import { PiiService } from '../pii/pii.service';
import { ProviderService } from '../ai/provider.service';
import { validateWithRetry } from '../validation/retry-once';

function sanitizeControlChars(text: string): string {
  return text
    .split('')
    .filter((c) => c.charCodeAt(0) >= 0x20 && c.charCodeAt(0) !== 0x7f)
    .join('');
}

function unwrapToSchema<T>(value: unknown, schema: ZodSchema<T>): unknown {
  if (schema.safeParse(value).success) return value;
  if (!value || typeof value !== 'object') return value;

  const queue: unknown[] = [value];
  const seen = new Set<unknown>();
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === null || typeof current !== 'object' || seen.has(current)) {
      continue;
    }
    seen.add(current);
    if (Array.isArray(current)) {
      for (const item of current) queue.push(item);
      continue;
    }
    for (const nested of Object.values(current as Record<string, unknown>)) {
      if (nested === null || typeof nested !== 'object') continue;
      if (schema.safeParse(nested).success) return nested;
      queue.push(nested);
    }
  }
  return value;
}

@Injectable()
export class LlmService {
  constructor(
    private readonly piiService: PiiService,
    private readonly providerService: ProviderService,
  ) {}

  async embed(text: string): Promise<number[]> {
    return this.providerService.hfEmbed(text);
  }

  /**
   * Plain chat through the provider with PII redaction on the way out and
   * restoration on the way back. Used by Mastra agents whose `LanguageModelV2`
   * adapter needs a `(system, user) => text` chat surface (same guarantees as
   * `generateStructured`, without JSON parsing).
   */
  async chat(systemPrompt: string, userPrompt: string): Promise<string> {
    const redactedSystem = this.piiService.redact(systemPrompt);
    const redactedUser = this.piiService.redact(
      userPrompt,
      redactedSystem.replacements.size,
    );
    const replacements = new Map([
      ...redactedSystem.replacements,
      ...redactedUser.replacements,
    ]);

    const content = await this.providerService.chat(
      redactedSystem.redacted,
      redactedUser.redacted,
    );

    if (replacements.size === 0) return content;
    return this.piiService.restore(content, replacements);
  }

  async generateStructured<T>(params: {
    systemPrompt: string;
    userPrompt: string;
    schema: ZodSchema<T>;
  }): Promise<T> {
    const { systemPrompt, userPrompt, schema } = params;

    const redactedSystem = this.piiService.redact(systemPrompt);
    const redactedUser = this.piiService.redact(
      userPrompt,
      redactedSystem.replacements.size,
    );
    const replacements = new Map([
      ...redactedSystem.replacements,
      ...redactedUser.replacements,
    ]);

    const callLlm = async (): Promise<unknown> => {
      const content = await this.providerService.chat(
        redactedSystem.redacted,
        redactedUser.redacted,
      );
      console.log('[LlmService] Raw response:', content);

      const cleaned = sanitizeControlChars(
        content.replace(/^```(?:json)?\s*\n?|\s*```$/g, ''),
      ).trim();

      if (!cleaned) throw new Error('Empty LLM response');

      const parsed: unknown = JSON.parse(cleaned);

      if (replacements.size > 0) {
        return unwrapToSchema(
          JSON.parse(
            sanitizeControlChars(
              this.piiService.restore(JSON.stringify(parsed), replacements),
            ),
          ),
          schema,
        );
      }

      return unwrapToSchema(parsed, schema);
    };

    const result = await validateWithRetry(
      schema,
      await callLlm().catch(() => null),
      callLlm,
      5,
    );

    return result;
  }
}
