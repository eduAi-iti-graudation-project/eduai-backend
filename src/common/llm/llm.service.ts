import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { ZodSchema } from 'zod';
import { PiiService } from '../pii/pii.service';
import { validateWithRetry } from '../validation/retry-once';

@Injectable()
export class LlmService {
  private readonly openai: OpenAI;

  constructor(private readonly piiService: PiiService) {
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  async embed(text: string): Promise<number[]> {
    const response = await this.openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
      dimensions: 1536,
    });
    return response.data[0].embedding;
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
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: redacted,
          },
          {
            role: 'user',
            content: userPrompt,
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error('Empty LLM response');

      const parsed: unknown = JSON.parse(content);

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
