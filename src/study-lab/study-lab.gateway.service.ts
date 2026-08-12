import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import type { AxiosResponse } from 'axios';

interface GatewayAudioResult {
  buffer: Buffer;
  mimeType: string;
}

type TtsProvider = 'gateway' | 'kokoro' | 'none';

const DEFAULT_KOKORO_URL = 'http://localhost:8880/v1';

@Injectable()
export class StudyLabGatewayService {
  private readonly logger = new Logger(StudyLabGatewayService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly audioModel: string | null;
  private readonly imageModel: string | null;
  private readonly provider: TtsProvider;
  private readonly kokoroUrl: string;
  private readonly gatewayHostVoice: string;
  private readonly gatewayGuestVoice: string;
  private readonly kokoroHostVoice: string;
  private readonly kokoroGuestVoice: string;

  constructor(private readonly http: HttpService) {
    this.baseUrl = process.env.CUSTOM_PROVIDER_BASE_URL!.replace(/\/+$/, '');
    this.apiKey = process.env.OPENAI_API_KEY!;
    this.audioModel = process.env.STUDY_AUDIO_MODEL?.trim() || null;
    this.imageModel = process.env.STUDY_IMAGE_MODEL?.trim() || null;
    this.kokoroUrl = (
      process.env.KOKORO_TTS_URL?.trim() || DEFAULT_KOKORO_URL
    ).replace(/\/+$/, '');
    this.gatewayHostVoice = process.env.STUDY_HOST_VOICE || 'Matthew';
    this.gatewayGuestVoice = process.env.STUDY_GUEST_VOICE || 'Joanna';
    this.kokoroHostVoice = process.env.KOKORO_HOST_VOICE?.trim() || 'af_heart';
    this.kokoroGuestVoice =
      process.env.KOKORO_GUEST_VOICE?.trim() || 'am_michael';
    this.provider = this.audioModel
      ? 'gateway'
      : process.env.KOKORO_TTS_URL?.trim()
        ? 'kokoro'
        : 'none';
  }

  get audioEnabled(): boolean {
    return this.provider !== 'none';
  }

  get imageEnabled(): boolean {
    return this.imageModel !== null;
  }

  get providerName(): TtsProvider {
    return this.provider;
  }

  async synthesizeSpeech(
    text: string,
    voice: string,
  ): Promise<GatewayAudioResult> {
    switch (this.provider) {
      case 'gateway':
        return this.gatewaySynthesize(text, voice);
      case 'kokoro':
        return this.kokoroSynthesize(text, voice);
      default:
        throw new Error(
          'No TTS provider configured — set STUDY_AUDIO_MODEL (gateway) or KOKORO_TTS_URL (Kokoro)',
        );
    }
  }

  private async gatewaySynthesize(
    text: string,
    voice: string,
  ): Promise<GatewayAudioResult> {
    if (!this.audioModel) {
      throw new Error(
        'Gateway audio model is not configured (STUDY_AUDIO_MODEL)',
      );
    }

    const words = text.trim().split(/\s+/).length;
    const body = {
      model_id: this.audioModel,
      prompt: text,
      duration_seconds: Math.max(5, Math.ceil(words / 2.5)),
      provider_payload: {
        text,
        voice,
      },
    };

    this.logger.log(
      `[study-lab TTS] model=${this.audioModel} voice=${voice} text=${text.slice(0, 60)}...`,
    );

    try {
      const { data } = await firstValueFrom<
        AxiosResponse<Record<string, unknown>>
      >(
        this.http.post<Record<string, unknown>>(
          `${this.baseUrl}/api/v1/student/audio`,
          body,
          {
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
            },
            timeout: 90000,
            responseType: 'json',
          },
        ),
      );

      return this.parseAudioResponse(data);
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'isAxiosError' in err) {
        const axiosErr = err as {
          response?: { status?: number; data?: unknown };
        };
        this.logger.error(
          `[study-lab TTS] gateway error — status: ${axiosErr.response?.status} body: ${JSON.stringify(
            axiosErr.response?.data,
          )}`,
        );
      }
      throw err;
    }
  }

  private async kokoroSynthesize(
    text: string,
    voice: string,
  ): Promise<GatewayAudioResult> {
    this.logger.log(
      `[study-lab TTS] kokoro voice=${voice} text=${text.slice(0, 60)}...`,
    );

    try {
      const { data } = await firstValueFrom<AxiosResponse<ArrayBuffer>>(
        this.http.post<ArrayBuffer>(
          `${this.kokoroUrl}/audio/speech`,
          {
            model: 'kokoro',
            voice,
            input: text,
            response_format: 'mp3',
            speed: 1.0,
          },
          {
            headers: { 'Content-Type': 'application/json' },
            timeout: 120000,
            responseType: 'arraybuffer',
          },
        ),
      );
      if (!data || data.byteLength === 0) {
        throw new Error(
          `Kokoro returned an empty audio response from ${this.kokoroUrl}`,
        );
      }
      return { buffer: Buffer.from(data), mimeType: 'audio/mpeg' };
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'isAxiosError' in err) {
        const axiosErr = err as {
          response?: { status?: number; data?: unknown };
        };
        this.logger.error(
          `[study-lab TTS] kokoro error — status: ${axiosErr.response?.status} body: ${JSON.stringify(
            axiosErr.response?.data,
          )}`,
        );
      }
      throw err;
    }
  }

  private parseAudioResponse(
    data: Record<string, unknown>,
  ): GatewayAudioResult {
    const pick = <T>(keys: string[]): T | undefined => {
      for (const key of keys) {
        if (typeof data[key] !== 'undefined' && data[key] !== null) {
          return data[key] as T;
        }
      }
      return undefined;
    };

    const base64 = pick<string>([
      'audio',
      'audio_base64',
      'audio_b64',
      'output_audio',
    ]);
    if (typeof base64 === 'string' && base64.length > 0) {
      return { buffer: Buffer.from(base64, 'base64'), mimeType: 'audio/mpeg' };
    }

    const buffer = pick<Buffer>(['audio_buffer', 'buffer']);
    if (Buffer.isBuffer(buffer)) {
      return { buffer, mimeType: 'audio/mpeg' };
    }

    throw new Error(
      `Gateway audio response did not contain recognizable audio data: ${JSON.stringify(
        data,
      ).slice(0, 300)}`,
    );
  }

  voicesFor(speaker: 'HOST' | 'GUEST'): string {
    if (this.provider === 'kokoro') {
      return speaker === 'HOST' ? this.kokoroHostVoice : this.kokoroGuestVoice;
    }
    return speaker === 'HOST' ? this.gatewayHostVoice : this.gatewayGuestVoice;
  }
}
