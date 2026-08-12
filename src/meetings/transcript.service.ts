import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService } from '../auth/supabase.service';
import { MeetingEventsGateway } from './meeting-events.gateway';
import { StruggleSignalsService } from '../struggle-signals/struggle-signals.service';

const execFileAsync = promisify(execFile);

interface WhisperChunk {
  timestamp?: [number, number] | null;
  text: string;
}

interface WhisperResult {
  text: string;
  chunks: WhisperChunk[];
}

/**
 * Turns recorded meeting audio into transcripts. Two artifact streams:
 *
 *  1. The room-composite MP4 → speaker-agnostic `MeetingTranscript` rows
 *     (the generic transcript panel).
 *  2. Per-participant track OGGs → `MeetingTranscriptSegment` rows tagged
 *     with the real userId of the speaker (deterministic attribution — the
 *     userId comes from the participant's join token, never from speaker
 *     diarization).
 *
 * Runs as a fire-and-forget background job triggered by the egress
 * webhook; failures are recorded as transcriptStatus = FAILED so the UI
 * can say so.
 */
@Injectable()
export class TranscriptService {
  private readonly logger = new Logger(TranscriptService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly supabase: SupabaseService,
    private readonly events: MeetingEventsGateway,
    private readonly struggleSignals: StruggleSignalsService,
  ) {}

  async transcribe(meetingId: string, storagePath: string): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), 'eduai-transcript-'));
    try {
      await this.prisma.meeting.update({
        where: { id: meetingId },
        data: { transcriptStatus: 'PROCESSING' },
      });

      const segments = await this.transcribeAudio(storagePath, dir);

      if (segments.length > 0) {
        await this.prisma.meetingTranscript.createMany({
          data: segments.map((s, order) => ({
            meetingId,
            order,
            startMs: s.startMs,
            endMs: s.endMs,
            text: s.text,
          })),
        });
      }

      await this.prisma.meeting.update({
        where: { id: meetingId },
        data: { transcriptStatus: 'READY' },
      });
      this.events.broadcastTranscript(meetingId, {
        status: 'READY',
        segments: segments.map((s) => ({
          startMs: s.startMs,
          endMs: s.endMs,
          text: s.text,
        })),
      });
      this.logger.log(
        `[transcript] meeting ${meetingId} done (${segments.length} segments)`,
      );
    } catch (cause) {
      this.logger.error(
        `[transcript] meeting ${meetingId} failed: ${(cause as Error).message}`,
        (cause as Error).stack,
      );
      await this.prisma.meeting.update({
        where: { id: meetingId },
        data: { transcriptStatus: 'FAILED' },
      });
      this.events.broadcastTranscript(meetingId, { status: 'FAILED' });
    } finally {
      void rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /**
   * Transcribe one participant's own audio track (per-participant egress)
   * into `MeetingTranscriptSegment` rows carrying that participant's real
   * userId. Timestamps are seconds from the meeting start so segments from
   * different participants can be compared in one timeline.
   */
  async transcribeParticipantTrack(
    meetingId: string,
    userId: string,
    storagePath: string,
  ): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), 'eduai-track-'));
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      if (!user) {
        this.logger.warn(
          `[transcript] skipping unknown participant ${userId} for meeting ${meetingId}`,
        );
        return;
      }

      const segments = await this.transcribeAudio(storagePath, dir);
      const rows = segments
        .map((s) => ({
          meetingId,
          userId,
          text: s.text,
          timestamp: Math.max(0, Math.round(s.startMs / 1000)),
          role: user.role,
        }))
        .filter((s) => s.text.length > 0);

      if (rows.length > 0) {
        await this.prisma.meetingTranscriptSegment.createMany({ data: rows });
        this.logger.log(
          `[transcript] participant ${userId} meeting ${meetingId}: ${rows.length} segments`,
        );
      }
    } catch (cause) {
      this.logger.error(
        `[transcript] participant ${userId} meeting ${meetingId} failed: ${(cause as Error).message}`,
      );
    } finally {
      void rm(dir, { recursive: true, force: true }).catch(() => undefined);
      // One participant's track is done (success or failure) — account for
      // it and let the struggle-signal pipeline know when nothing is left
      // in flight.
      await this.struggleSignals.onParticipantTrackEgressFinished(meetingId);
    }
  }

  /** ffmpeg (16kHz mono WAV) → transformers.js Whisper (ONNX). */
  private async transcribeAudio(
    storagePath: string,
    dir: string,
  ): Promise<{ startMs: number; endMs: number; text: string }[]> {
    const bucket = process.env.SUPABASE_MEETINGS_BUCKET ?? 'meetings';
    const { data, error } = await this.supabase
      .getStorageClient()
      .storage.from(bucket)
      .createSignedUrl(storagePath, 3600);
    if (error || !data) {
      throw new Error('Could not create a signed URL for the recording');
    }

    const wavPath = join(dir, 'audio.wav');
    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-i',
        data.signedUrl,
        '-vn',
        '-ac',
        '1',
        '-ar',
        '16000',
        '-f',
        'wav',
        wavPath,
      ],
      { timeout: 15 * 60 * 1000 },
    );

    const { pipeline, env } = await import('@xenova/transformers');
    env.allowLocalModels = false;
    const transcriber = await pipeline(
      'automatic-speech-recognition',
      process.env.TRANSCRIPT_MODEL ?? 'Xenova/whisper-small',
    );
    const result = (await transcriber(wavPath, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true,
    })) as WhisperResult;

    return (result.chunks ?? [])
      .map((chunk) => ({
        startMs: Math.max(0, Math.round((chunk.timestamp?.[0] ?? 0) * 1000)),
        endMs: Math.round((chunk.timestamp?.[1] ?? 0) * 1000),
        text: chunk.text.trim(),
      }))
      .filter((s) => s.text.length > 0);
  }
}
