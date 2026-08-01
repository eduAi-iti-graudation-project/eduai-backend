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

@Injectable()
export class LlmService {
  constructor(
    private readonly piiService: PiiService,
    private readonly providerService: ProviderService,
  ) {}

  async embed(text: string): Promise<number[]> {
    return this.providerService.hfEmbed(text);
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
        return JSON.parse(
          sanitizeControlChars(
            this.piiService.restore(JSON.stringify(parsed), replacements),
          ),
        ) as unknown;
      }

      return parsed;
    };

    const result = await validateWithRetry(
      schema,
      await callLlm().catch(() => null),
      callLlm,
      3,
    );

    return result;
  }
}
