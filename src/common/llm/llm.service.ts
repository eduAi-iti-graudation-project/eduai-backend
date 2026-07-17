import { Injectable } from '@nestjs/common';
import { ZodSchema } from 'zod';
import { PiiService } from '../pii/pii.service';
import { ProviderService } from '../ai/provider.service';
import { validateWithRetry } from '../validation/retry-once';

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

    const { redacted, replacements } = this.piiService.redact(
      `${systemPrompt}\n${userPrompt}`,
    );

    const callLlm = async (): Promise<unknown> => {
      const content = await this.providerService.chat(redacted, userPrompt);
      console.log('[LlmService] Raw response:', content);

      const cleaned = content
        .replace(/^```(?:json)?\s*\n?|\s*```$/g, '')
        .trim();

      if (!cleaned) throw new Error('Empty LLM response');

      const parsed: unknown = JSON.parse(cleaned);

      if (replacements.size > 0) {
        return JSON.parse(
          this.piiService.restore(JSON.stringify(parsed), replacements),
        ) as unknown;
      }

      return parsed;
    };

    const result = await validateWithRetry(
      schema,
      await callLlm().catch(() => null),
      callLlm,
    );

    return result;
  }
}
