import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import type { AxiosResponse } from 'axios';

interface ChatResponse {
  output_text?: string;
}

@Injectable()
export class ProviderService {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly chatModel: string;
  private readonly hfToken: string;
  private readonly hfEmbedModel: string;

  constructor(private readonly http: HttpService) {
    this.baseUrl = process.env.CUSTOM_PROVIDER_BASE_URL!.replace(/\/+$/, '');
    this.apiKey = process.env.OPENAI_API_KEY!;
    this.chatModel = process.env.CUSTOM_CHAT_MODEL || 'openai.gpt-oss-20b-1:0';
    this.hfToken = process.env.HF_TOKEN || '';
    this.hfEmbedModel =
      process.env.HF_EMBED_MODEL || 'mixedbread-ai/mxbai-embed-large-v1';
  }

  async chat(systemPrompt: string, userPrompt: string): Promise<string> {
    const body = {
      model_id: this.chatModel,
      messages: [
        {
          role: 'user' as const,
          text: `${systemPrompt}\n\n${userPrompt}`,
        },
      ],
      max_tokens: 2048,
    };

    console.log('[ProviderService] request:', JSON.stringify(body, null, 2));

    try {
      const { data } = await firstValueFrom<AxiosResponse<ChatResponse>>(
        this.http.post<ChatResponse>(
          `${this.baseUrl}/api/v1/student/multimodal-chat`,
          body,
          {
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
            },
          },
        ),
      );

      console.log(
        '[ProviderService] response data:',
        JSON.stringify(data, null, 2),
      );
      return (data.output_text || '').trim();
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'isAxiosError' in err) {
        const axiosErr = err as {
          response?: { status?: number; data?: unknown };
        };
        console.error(
          '[ProviderService] Axios error — status:',
          axiosErr.response?.status,
          'body:',
          JSON.stringify(axiosErr.response?.data, null, 2),
        );
      }
      throw err;
    }
  }

  async hfEmbed(inputs: string): Promise<number[]> {
    if (!this.hfToken) {
      throw new Error('HF_TOKEN is not set');
    }

    const response = await fetch(
      `https://router.huggingface.co/hf-inference/models/${this.hfEmbedModel}/pipeline/feature-extraction`,
      {
        headers: {
          Authorization: `Bearer ${this.hfToken}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
        body: JSON.stringify({ inputs }),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`HuggingFace embed failed (${response.status}): ${body}`);
    }

    const result = (await response.json()) as number[];
    console.log(
      '[ProviderService] hfEmbed returned',
      result.length,
      'dimensions',
    );
    return result;
  }
}
