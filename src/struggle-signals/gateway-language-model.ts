import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2Message,
} from '@ai-sdk/provider';

/** The only chat surface the ITI gateway exposes (Prompts as strings). */
export type GatewayChat = (
  systemPrompt: string,
  userPrompt: string,
) => Promise<string>;

/**
 * AI SDK `LanguageModelV2` adapter over the repo's `ProviderService.chat`
 * gateway. The gateway is NOT OpenAI-compatible, so Mastra cannot address it
 * by model id — the agent is instead given this direct model instance and the
 * AI SDK runtime drives it solely through `doGenerate`.
 *
 * It reports `supportsStructuredOutputs: false`, so when the agent runs in
 * structured-output mode the runtime injects JSON-shape instructions into the
 * system prompt and parses/validates the JSON returned in the text response.
 */
export const createGatewayLanguageModel = (
  chat: GatewayChat,
  modelId: string = process.env.CUSTOM_CHAT_MODEL || 'openai.gpt-oss-20b-1:0',
): LanguageModelV2 => ({
  specificationVersion: 'v2',
  provider: 'iti-gateway',
  modelId,
  supportedUrls: {},
  async doGenerate(options: LanguageModelV2CallOptions) {
    const { systemPrompt, userPrompt } = flattenPrompt(options.prompt);
    const text = await chat(systemPrompt, userPrompt);
    return {
      content: [{ type: 'text', text }],
      finishReason: 'stop',
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      warnings: [],
      request: {},
      response: {},
    };
  },
  doStream() {
    throw new Error('Streaming is not supported by the ITI gateway model');
  },
});

function flattenPrompt(prompt: LanguageModelV2Message[]): {
  systemPrompt: string;
  userPrompt: string;
} {
  let systemPrompt = '';
  const parts: string[] = [];
  for (const message of prompt) {
    if (message.role === 'system') {
      systemPrompt += (systemPrompt ? '\n\n' : '') + message.content;
      continue;
    }
    for (const part of message.content) {
      if (part.type === 'text') {
        parts.push(part.text);
      }
    }
  }
  return { systemPrompt, userPrompt: parts.join('\n\n') };
}
