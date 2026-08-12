import { Injectable, Logger } from '@nestjs/common';
import {
  AutoTrackEgress,
  EgressClient,
  EncodedFileOutput,
  EncodedFileType,
  RoomCompositeEgressRequest,
  RoomEgress,
  RoomServiceClient,
  S3Upload,
  WebhookReceiver,
} from 'livekit-server-sdk';
import type { WebhookEvent } from 'livekit-server-sdk';
import { TrackType } from '@livekit/protocol';

/**
 * Thin wrapper over the LiveKit Cloud APIs: room lifecycle (with egress
 * recording baked in) and webhook signature verification.
 *
 * Recording a meeting produces TWO artifact streams:
 *  1. a room-composite MP4 (the watchable playback recording), and
 *  2. per-participant audio tracks (AutoTrackEgress) — one file per
 *     participant, keyed by `{participant_identity}`, which is the app's
 *     userId from that participant's join token.
 *
 * The per-track stream is what gives the app deterministic who-said-what
 * attribution for post-meeting follow-up material — no speaker
 * diarization, no voice matching, ever.
 *
 * All calls are no-ops when LiveKit is not configured (LIVEKIT_URL /
 * LIVEKIT_API_KEY / LIVEKIT_API_SECRET missing), so the rest of the app
 * degrades gracefully in local dev.
 */
@Injectable()
export class LivekitService {
  private readonly logger = new Logger(LivekitService.name);

  /**
   * Values shipped in .env/.env.example as dev stand-ins. They make the
   * credentials "non-empty" while being useless against the live API, so
   * they must be treated exactly like missing config — otherwise every
   * join attempt 500s against a phantom endpoint.
   */
  private static readonly DEV_PLACEHOLDERS = new Set([
    'devkey',
    'devsecret_at_least_16_chars_for_dev',
    'your-livekit-api-key',
    'your-livekit-api-secret',
    'wss://dev.example.livekit.cloud',
    'wss://your-project.livekit.cloud',
  ]);

  private static looksConfigured(value: string | undefined): boolean {
    return Boolean(
      value &&
      value.trim().length > 0 &&
      !LivekitService.DEV_PLACEHOLDERS.has(value.trim()),
    );
  }

  isConfigured(): boolean {
    return (
      LivekitService.looksConfigured(process.env.LIVEKIT_URL) &&
      LivekitService.looksConfigured(process.env.LIVEKIT_API_KEY) &&
      LivekitService.looksConfigured(process.env.LIVEKIT_API_SECRET)
    );
  }

  /**
   * Recording egress writes to Supabase S3. LiveKit validates the S3 sink
   * at room creation, so a configured LiveKit project with no S3 creds
   * would reject recording-enabled rooms outright. Only attach egress when
   * the storage side is actually wired up.
   */
  isStorageConfigured(): boolean {
    return Boolean(
      process.env.SUPABASE_STORAGE_S3_ACCESS_KEY &&
      process.env.SUPABASE_STORAGE_S3_SECRET_KEY &&
      process.env.SUPABASE_STORAGE_S3_ENDPOINT &&
      process.env.SUPABASE_MEETINGS_BUCKET,
    );
  }

  private get roomClient(): RoomServiceClient {
    return new RoomServiceClient(
      process.env.LIVEKIT_URL ?? '',
      process.env.LIVEKIT_API_KEY,
      process.env.LIVEKIT_API_SECRET,
    );
  }

  private get egressClient(): EgressClient {
    return new EgressClient(
      process.env.LIVEKIT_URL ?? '',
      process.env.LIVEKIT_API_KEY,
      process.env.LIVEKIT_API_SECRET,
    );
  }

  /**
   * Ensure the LiveKit room exists before the first participant joins.
   * Egress config can only be set at room creation, so the meeting's
   * recording flag is baked in here — but only when S3 storage is
   * configured; otherwise the room starts unrecorded (with a warning)
   * instead of failing to create. Idempotent — safe to call on every join.
   */
  async ensureRoom(input: {
    roomName: string;
    recordingEnabled: boolean;
  }): Promise<void> {
    if (!this.isConfigured()) return;
    if (input.recordingEnabled && !this.isStorageConfigured()) {
      this.logger.warn(
        `[livekit] meeting ${input.roomName} asks for recording but S3 storage isn't configured — starting the room unrecorded`,
      );
    }
    const existing = await this.roomClient.listRooms([input.roomName]);
    if (existing.length > 0) return;

    await this.roomClient.createRoom({
      name: input.roomName,
      ...(input.recordingEnabled && this.isStorageConfigured()
        ? {
            egress: new RoomEgress({
              room: this.roomEgressRequest(input.roomName),
              tracks: this.trackEgress(input.roomName),
            }),
          }
        : {}),
    });
    this.logger.log(
      `[livekit] room ${input.roomName} ensured (recording=${input.recordingEnabled}, per-participant tracks)`,
    );
  }

  /**
   * Start recording a live room (recording toggled from inside the call).
   * Composite MP4 for playback, plus one audio egress per currently
   * published track so the transcript still gets per-participant
   * attribution when recording was toggled mid-meeting.
   */
  async startRecording(roomName: string): Promise<string> {
    if (!this.isStorageConfigured()) {
      this.logger.warn(
        `[livekit] recording toggle ignored for ${roomName} — S3 storage isn't configured`,
      );
      return '';
    }
    const composite = await this.egressClient.startRoomCompositeEgress(
      roomName,
      this.fileOutput(roomName),
      { layout: 'grid' },
    );
    await this.startTrackEgressForCurrentTracks(roomName);
    this.logger.log(
      `[livekit] egress ${composite.egressId} started for ${roomName} (composite + per-track)`,
    );
    return composite.egressId;
  }

  async stopRecording(egressId: string): Promise<void> {
    if (!egressId || !this.isStorageConfigured()) return;
    await this.egressClient.stopEgress(egressId);
    this.logger.log(`[livekit] egress ${egressId} stopped`);
  }

  /** Verify + decode a LiveKit webhook payload (HMAC with the API secret). */
  async receiveWebhook(
    rawBody: Buffer,
    signature: string | undefined,
  ): Promise<WebhookEvent> {
    const receiver = new WebhookReceiver(
      process.env.LIVEKIT_API_KEY ?? '',
      process.env.LIVEKIT_API_SECRET ?? '',
    );
    return receiver.receive(rawBody.toString(), signature ?? '');
  }

  /** Room-level egress config (baked in at room creation). */
  private roomEgressRequest(roomName: string): RoomCompositeEgressRequest {
    return new RoomCompositeEgressRequest({
      roomName,
      layout: 'grid',
      fileOutputs: [this.fileOutput(roomName)],
    });
  }

  /** Composite MP4 → Supabase storage (path-style S3-compatible). */
  private fileOutput(roomName: string): EncodedFileOutput {
    const s3 = this.s3Upload();
    const file = new EncodedFileOutput({
      fileType: EncodedFileType.MP4,
      filepath: `meetings/${roomName}/recording-{time}.mp4`,
    });
    file.output = { case: 's3', value: s3 };
    return file;
  }

  /**
   * AutoTrackEgress: every audio track published in the room is recorded
   * to its own file, keyed by `{participant_identity}` — the participant's
   * join-token userId. Tracks published after room creation are picked up
   * automatically (late joiners included). See LiveKit docs on filepath
   * templating for {participant_identity}.
   */
  private trackEgress(roomName: string): AutoTrackEgress {
    return new AutoTrackEgress({
      filepath: `meetings/${roomName}/tracks/{participant_identity}/{track_id}-{time}.ogg`,
      output: { case: 's3', value: this.s3Upload() },
    });
  }

  /**
   * Live-toggle fallback: for rooms that were created without the
   * auto-track config, start one audio-track egress per currently-published
   * track so per-participant attribution still works mid-meeting.
   */
  private async startTrackEgressForCurrentTracks(
    roomName: string,
  ): Promise<void> {
    const participants = await this.roomClient.listParticipants(roomName);
    for (const participant of participants) {
      for (const track of participant.tracks ?? []) {
        if (track.type !== TrackType.AUDIO) continue;
        try {
          await this.egressClient.startTrackEgress(
            roomName,
            this.trackFileOutput(roomName, participant.identity),
            track.sid,
          );
        } catch (error) {
          this.logger.warn(
            `[livekit] failed to start track egress for ${participant.identity}: ${(error as Error).message}`,
          );
        }
      }
    }
  }

  /** OGG audio output for a per-participant track egress. */
  private trackFileOutput(
    roomName: string,
    identity: string,
  ): EncodedFileOutput {
    const file = new EncodedFileOutput({
      fileType: EncodedFileType.OGG,
      filepath: `meetings/${roomName}/tracks/${identity}/{track_id}-{time}.ogg`,
    });
    file.output = { case: 's3', value: this.s3Upload() };
    return file;
  }

  private s3Upload(): S3Upload {
    return new S3Upload({
      accessKey: process.env.SUPABASE_STORAGE_S3_ACCESS_KEY ?? '',
      secret: process.env.SUPABASE_STORAGE_S3_SECRET_KEY ?? '',
      endpoint: process.env.SUPABASE_STORAGE_S3_ENDPOINT ?? '',
      region: process.env.SUPABASE_STORAGE_S3_REGION ?? 'us-east-1',
      bucket: process.env.SUPABASE_MEETINGS_BUCKET ?? 'meetings',
      forcePathStyle: true,
    });
  }
}
