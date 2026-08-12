import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
} from '@ai-sdk/provider';

interface StructuredOptions {
  structuredOutput?: {
    schema: {
      safeParse(
        value: unknown,
      ): { success: true; data: unknown } | { success: false };
    };
  };
}

/**
 * Stand-in for `@mastra/core/agent`'s Agent, mapping to the real runtime's
 * behavior for the two patterns the repo uses:
 * - `agent.generate(input)` — echoes the model's text back
 * - `agent.generate(input, { structuredOutput: { schema } })` — drives the
 *   configured (real) LanguageModelV2 adapter, then JSON-parses + validates
 *   the reply and returns it as `object`, mirroring Mastra's handling of
 *   models with `supportsStructuredOutputs: false`.
 *
 * The real adapter + real schema validation still run — only the framework's
 * own internals are stubbed (they pull ESM-only deps into Jest).
 */
export class Agent {
  private readonly config: {
    instructions: string;
    model: LanguageModelV2;
  };

  constructor(config: {
    id: string;
    name: string;
    instructions: string;
    model: LanguageModelV2;
  }) {
    this.config = config;
  }

  async generate(
    input: string,
    options: StructuredOptions = {},
  ): Promise<{ object?: unknown; text: string }> {
    const callOptions: LanguageModelV2CallOptions = {
      prompt: [
        { role: 'system', content: this.config.instructions },
        {
          role: 'user',
          content: [{ type: 'text', text: input }],
        },
      ],
    };
    const result = await this.config.model.doGenerate(callOptions);
    const text = result.content
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('');

    if (options.structuredOutput) {
      const schema = options.structuredOutput.schema;
      const parsed = schema.safeParse(JSON.parse(text));
      if (!parsed.success) {
        throw new Error('Model output failed schema validation');
      }
      return { object: parsed.data, text };
    }
    return { text };
  }
}
