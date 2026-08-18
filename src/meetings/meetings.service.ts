import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AccessToken } from 'livekit-server-sdk';
import type { Prisma, User } from '@prisma/client';
import type { WebhookEvent } from 'livekit-server-sdk';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService } from '../auth/supabase.service';
import { LivekitService } from './livekit.service';
import { TranscriptService } from './transcript.service';
import { StruggleSignalsService } from '../struggle-signals/struggle-signals.service';
import { MeetingEventsGateway } from './meeting-events.gateway';
import type { CreateMeetingInput } from './dto';

const TOKEN_TTL_SECONDS = 15 * 60; // short-lived: one join = one token

const meetingInclude = {
  courseOffering: {
    include: {
      course: true,
      section: { include: { enrollments: true } },
    },
  },
  createdByUser: true,
  participants: { include: { user: true } },
  attendance: { include: { user: true } },
  _count: { select: { transcripts: true } },
} satisfies Prisma.MeetingInclude;

type MeetingWithRelations = Prisma.MeetingGetPayload<{
  include: typeof meetingInclude;
}>;

@Injectable()
export class MeetingsService {
  private readonly logger = new Logger(MeetingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly supabase: SupabaseService,
    private readonly livekit: LivekitService,
    private readonly transcriptService: TranscriptService,
    private readonly struggleSignals: StruggleSignalsService,
    private readonly events: MeetingEventsGateway,
  ) {}

  // ─── Create ───────────────────────────────────────────
  async create(user: User, dto: CreateMeetingInput) {
    const organizationId = user.organizationId;

    let courseOfferingId: string | null = null;
    let participantIds: string[] = [];

    if (dto.type === 'CLASS') {
      const offering = await this.prisma.courseOffering.findFirst({
        where: {
          id: dto.courseOfferingId,
          organizationId: organizationId ?? undefined,
        },
      });
      if (!offering) {
        throw new NotFoundException(
          'This class could not be found in your organization.',
        );
      }
      // A TEACHER may only create a CLASS meeting for a CourseOffering they teach.
      if (offering.teacherId !== user.id) {
        throw new ForbiddenException(
          'You can only schedule class meetings for classes you teach.',
        );
      }
      courseOfferingId = offering.id;
    } else {
      const requested = dto.participantIds ?? [];
      const found = await this.prisma.user.findMany({
        where: { id: { in: requested }, organizationId },
        select: { id: true },
      });
      if (found.length !== requested.length) {
        throw new NotFoundException(
          'One or more participants do not exist in your organization.',
        );
      }
      participantIds = requested;
    }

    const roomName = `meeting-${randomUUID()}`;
    const meeting = await this.prisma.meeting.create({
      data: {
        organizationId: organizationId!,
        title: dto.title,
        type: dto.type,
        courseOfferingId,
        createdBy: user.id,
        scheduledStart: dto.scheduledStart,
        scheduledEnd: dto.scheduledEnd,
        recordingEnabled: dto.recordingEnabled ?? false,
        roomName,
        participants: participantIds.length
          ? {
              create: participantIds.map((userId) => ({ userId })),
            }
          : undefined,
      },
      include: meetingInclude,
    });

    this.logger.log(
      `[meetings] ${user.role} ${user.id} created ${dto.type} meeting ${meeting.id}`,
    );
    return this.toDetail(user, meeting);
  }

  // ─── Join (token issuance) ────────────────────────────
  async join(user: User, meetingId: string) {
    const meeting = await this.findForUser(user, meetingId);
    if (!meeting) {
      throw new NotFoundException('This meeting could not be found.');
    }
    if (meeting.status === 'ENDED' || meeting.status === 'CANCELED') {
      throw new ForbiddenException(
        meeting.status === 'ENDED'
          ? 'This meeting has ended.'
          : 'This meeting was canceled.',
      );
    }
    if (!this.canJoin(user, meeting)) {
      throw new ForbiddenException('You are not allowed to join this meeting.');
    }

    // Create the LiveKit room (with egress baked in) before issuing the token.
    await this.livekit.ensureRoom({
      roomName: meeting.roomName,
      recordingEnabled: meeting.recordingEnabled,
    });

    const token = new AccessToken(
      process.env.LIVEKIT_API_KEY,
      process.env.LIVEKIT_API_SECRET,
      { identity: user.id, name: user.name, ttl: TOKEN_TTL_SECONDS },
    );
    token.addGrant({
      room: meeting.roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    // Attendance: one row per participant; a re-join resets leftAt.
    const existing = await this.prisma.meetingAttendance.findFirst({
      where: { meetingId: meeting.id, userId: user.id },
    });
    if (existing) {
      await this.prisma.meetingAttendance.update({
        where: { id: existing.id },
        data: { joinedAt: new Date(), leftAt: null },
      });
    } else {
      await this.prisma.meetingAttendance.create({
        data: { meetingId: meeting.id, userId: user.id, joinedAt: new Date() },
      });
    }

    // First join flips the meeting to LIVE.
    if (meeting.status === 'SCHEDULED') {
      await this.prisma.meeting.update({
        where: { id: meeting.id },
        data: { status: 'LIVE' },
      });
    }

    return {
      token: await token.toJwt(),
      url: process.env.LIVEKIT_URL ?? '',
      roomName: meeting.roomName,
      identity: user.id,
    };
  }

  // ─── Leave ────────────────────────────────────────────
  async leave(user: User, meetingId: string) {
    const meeting = await this.findForUser(user, meetingId);
    if (!meeting) {
      throw new NotFoundException('This meeting could not be found.');
    }
    const leftAt = new Date();
    await this.prisma.meetingAttendance.updateMany({
      where: { meetingId: meeting.id, userId: user.id, leftAt: null },
      data: { leftAt },
    });
    return { leftAt: leftAt.toISOString() };
  }

  // ─── End (host only) ──────────────────────────────────
  async end(user: User, meetingId: string) {
    const meeting = await this.findForUser(user, meetingId);
    if (!meeting) {
      throw new NotFoundException('This meeting could not be found.');
    }
    if (!this.isHost(user, meeting)) {
      throw new ForbiddenException(
        'Only the meeting host can end this meeting.',
      );
    }
    if (meeting.status === 'ENDED') {
      return this.toDetail(user, meeting);
    }
    const updated = await this.prisma.meeting.update({
      where: { id: meeting.id },
      data: { status: 'ENDED' },
      include: meetingInclude,
    });
    this.logger.log(`[meetings] meeting ${meeting.id} ended by ${user.id}`);
    return this.toDetail(user, updated);
  }

  // ─── Recording toggle (host only) ─────────────────────
  async setRecording(user: User, meetingId: string, enabled: boolean) {
    const meeting = await this.findForUser(user, meetingId);
    if (!meeting) {
      throw new NotFoundException('This meeting could not be found.');
    }
    if (!this.isHost(user, meeting)) {
      throw new ForbiddenException(
        'Only the meeting host can change recording settings.',
      );
    }
    // Live rooms record on demand; rooms not yet created get egress at
    // creation time (see LivekitService.ensureRoom).
    if (meeting.status === 'LIVE') {
      if (enabled && !meeting.recordingEgressId) {
        let egressId = '';
        try {
          egressId = await this.livekit.startRecording(meeting.roomName);
        } catch (err: any) {
          this.logger.warn(
            `[meetings] startRecording warning: ${err?.message ?? err}`,
          );
        }
        await this.prisma.meeting.update({
          where: { id: meeting.id },
          data: {
            recordingEnabled: true,
            recordingEgressId: egressId || null,
          },
        });
      } else if (!enabled) {
        if (meeting.recordingEgressId) {
          try {
            await this.livekit.stopRecording(meeting.recordingEgressId);
          } catch (err: any) {
            this.logger.warn(
              `[meetings] stopRecording warning: ${err?.message ?? err}`,
            );
          }
        }
        await this.prisma.meeting.update({
          where: { id: meeting.id },
          data: { recordingEnabled: false, recordingEgressId: null },
        });
      }
      const refreshed = await this.prisma.meeting.findFirst({
        where: { id: meeting.id },
        include: meetingInclude,
      });
      this.logger.log(
        `[meetings] recording ${enabled ? 'enabled' : 'disabled'} for meeting ${meeting.id} by ${user.id}`,
      );
      return this.toDetail(user, refreshed ?? meeting);
    }

    const updated = await this.prisma.meeting.update({
      where: { id: meeting.id },
      data: { recordingEnabled: enabled },
      include: meetingInclude,
    });
    this.logger.log(
      `[meetings] recording ${enabled ? 'enabled' : 'disabled'} for meeting ${meeting.id} by ${user.id}`,
    );
    return this.toDetail(user, updated);
  }

  // ─── List (role-scoped) ───────────────────────────────
  async list(user: User, scope: 'upcoming' | 'past' | 'all' = 'all') {
    const now = new Date();
    // Self-heal: Any meeting whose scheduled end time has passed automatically
    // transitions to ENDED so it cleanly moves to past meetings and never vanishes.
    await this.prisma.meeting.updateMany({
      where: {
        organizationId: user.organizationId ?? undefined,
        status: { in: ['LIVE', 'SCHEDULED'] },
        scheduledEnd: { lt: now },
      },
      data: { status: 'ENDED' },
    });

    const where: Prisma.MeetingWhereInput = {
      organizationId: user.organizationId ?? undefined,
      AND: [
        this.visibilityWhere(user),
        ...(scope === 'upcoming'
          ? [{ status: { in: ['SCHEDULED' as const, 'LIVE' as const] } }]
          : scope === 'past'
            ? [{ status: { in: ['ENDED' as const, 'CANCELED' as const] } }]
            : []),
      ],
    };

    const meetings = await this.prisma.meeting.findMany({
      where,
      include: meetingInclude,
      orderBy: { scheduledStart: 'desc' },
    });

    return {
      meetings: meetings.map((m) => this.toSummary(user, m)),
    };
  }

  // ─── Get one ──────────────────────────────────────────
  async findOne(user: User, meetingId: string) {
    const meeting = await this.findForUser(user, meetingId);
    if (!meeting) {
      throw new NotFoundException('This meeting could not be found.');
    }
    return this.toDetail(user, meeting);
  }

  // ─── Recording playback (same permission as joining) ──
  async getRecording(user: User, meetingId: string) {
    const meeting = await this.findForUser(user, meetingId);
    if (!meeting) {
      throw new NotFoundException('This meeting could not be found.');
    }
    if (!this.canJoin(user, meeting)) {
      throw new ForbiddenException(
        'You are not allowed to watch this meeting recording.',
      );
    }
    if (!meeting.recordingUrl) {
      throw new NotFoundException(
        'This meeting has no recording available yet.',
      );
    }
    const recordingUrl = meeting.recordingUrl.startsWith('http')
      ? meeting.recordingUrl
      : await this.meetingsSignedUrl(meeting.recordingUrl);
    return { recordingUrl };
  }

  // ─── In-meeting chat ──────────────────────────────────
  async listMessages(
    user: User,
    meetingId: string,
    cursor?: string,
    limit = 50,
  ) {
    const meeting = await this.findForUser(user, meetingId);
    if (!meeting) {
      throw new NotFoundException('This meeting could not be found.');
    }
    if (!this.canJoin(user, meeting)) {
      throw new ForbiddenException(
        'You are not allowed to view this meeting chat.',
      );
    }
    const messages = await this.prisma.meetingChatMessage.findMany({
      where: {
        meetingId: meeting.id,
        ...(cursor ? { id: { lt: cursor } } : {}),
      },
      include: { user: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return {
      messages: messages.reverse().map((m) => this.toChatMessage(m)),
    };
  }

  async sendMessage(user: User, meetingId: string, text: string) {
    const meeting = await this.findForUser(user, meetingId);
    if (!meeting) {
      throw new NotFoundException('This meeting could not be found.');
    }
    if (!this.canJoin(user, meeting)) {
      throw new ForbiddenException(
        'You are not allowed to chat in this meeting.',
      );
    }
    const message = await this.prisma.meetingChatMessage.create({
      data: { meetingId: meeting.id, userId: user.id, text },
      include: { user: true },
    });
    const payload = this.toChatMessage(message);
    this.events.broadcastMessage(payload);
    return payload;
  }

  // ─── Transcript ───────────────────────────────────────
  async getTranscript(user: User, meetingId: string) {
    const meeting = await this.findForUser(user, meetingId);
    if (!meeting) {
      throw new NotFoundException('This meeting could not be found.');
    }
    if (!this.canJoin(user, meeting)) {
      throw new ForbiddenException(
        'You are not allowed to view this meeting transcript.',
      );
    }
    const segments = await this.prisma.meetingTranscript.findMany({
      where: { meetingId: meeting.id },
      orderBy: { order: 'asc' },
    });
    const status =
      segments.length > 0 ? 'READY' : meeting.transcriptStatus;
    return {
      status,
      segments: segments.map((s) => ({
        startMs: s.startMs,
        endMs: s.endMs,
        text: s.text,
      })),
    };
  }

  async saveLiveTranscript(
    user: User,
    meetingId: string,
    segments: { startMs: number; endMs?: number; text: string }[],
  ) {
    const meeting = await this.findForUser(user, meetingId);
    if (!meeting) {
      throw new NotFoundException('This meeting could not be found.');
    }
    if (!segments.length) {
      return { status: meeting.transcriptStatus };
    }

    const existingCount = await this.prisma.meetingTranscript.count({
      where: { meetingId: meeting.id },
    });

    await this.prisma.meetingTranscript.createMany({
      data: segments.map((s, idx) => ({
        meetingId: meeting.id,
        order: existingCount + idx,
        startMs: s.startMs ?? 0,
        endMs: s.endMs ?? (s.startMs + 3000),
        text: s.text,
      })),
    });

    await this.prisma.meeting.update({
      where: { id: meeting.id },
      data: { transcriptStatus: 'READY' },
    });

    return { status: 'READY' };
  }

  // ─── LiveKit webhook dispatch ─────────────────────────
  async handleLivekitEvent(event: WebhookEvent) {
    const roomName = event.room?.name;
    if (!roomName) {
      this.logger.warn(
        `[livekit-webhook] ${event.event} without room name, ignored`,
      );
      return;
    }
    const meeting = await this.prisma.meeting.findUnique({
      where: { roomName },
    });
    if (!meeting) {
      this.logger.warn(
        `[livekit-webhook] ${event.event} for unknown room ${roomName}`,
      );
      return;
    }

    switch (event.event as string) {
      case 'participant_joined': {
        const userId = event.participant?.identity;
        if (!userId) break;
        const existing = await this.prisma.meetingAttendance.findFirst({
          where: { meetingId: meeting.id, userId },
        });
        if (existing) {
          await this.prisma.meetingAttendance.update({
            where: { id: existing.id },
            data: { joinedAt: new Date(), leftAt: null },
          });
        } else {
          await this.prisma.meetingAttendance.create({
            data: { meetingId: meeting.id, userId, joinedAt: new Date() },
          });
        }
        break;
      }
      case 'participant_left': {
        const userId = event.participant?.identity;
        if (!userId) break;
        await this.prisma.meetingAttendance.updateMany({
          where: { meetingId: meeting.id, userId, leftAt: null },
          data: { leftAt: new Date() },
        });
        break;
      }
      case 'room_finished': {
        const now = new Date();
        // A room closing before its scheduled start is a spurious lifecycle
        // (test join, manual room close, empty-timeout on a pre-created
        // room) — do not retroactively end a meeting that hasn't begun.
        if (meeting.scheduledStart > now) {
          this.logger.log(
            `[livekit-webhook] room_finished for meeting ${meeting.id} before scheduled start, ignoring`,
          );
          break;
        }
        await this.prisma.meeting.update({
          where: { id: meeting.id },
          data: { status: 'ENDED' },
        });
        await this.prisma.meetingAttendance.updateMany({
          where: { meetingId: meeting.id, leftAt: null },
          data: { leftAt: new Date() },
        });
        // Safety net: in-flight per-participant transcripts may still be
        // processing; the counter + poll in the struggle-signals service
        // waits for them before extracting signals once.
        void this.struggleSignals
          .finalizeStruggleExtraction(meeting.id)
          .catch((err: Error) =>
            this.logger.error(
              `[livekit-webhook] struggle-signal finalize failed: ${err?.message}`,
            ),
          );
        break;
      }
      case 'egress_started': {
        const egressId = event.egressInfo?.egressId;
        if (!egressId) break;
        await this.prisma.meeting.update({
          where: { id: meeting.id },
          data: { recordingEgressId: egressId },
        });
        break;
      }
      case 'egress_ended': {
        const location = event.egressInfo?.fileResults?.[0]?.location;
        if (location) {
          await this.prisma.meeting.update({
            where: { id: meeting.id },
            data: {
              recordingUrl: this.storageKeyFromLocation(location),
              recordingEgressId: null,
              recordingEnabled: false,
            },
          });
        }
        // Transcript is the point of this whole pipeline — kick it off
        // asynchronously so the webhook returns quickly.
        if (location) {
          void this.transcriptService.transcribe(
            meeting.id,
            this.storageKeyFromLocation(location),
          );
        }
        break;
      }
      case 'egress_failed': {
        await this.prisma.meeting.update({
          where: { id: meeting.id },
          data: {
            recordingEgressId: null,
            recordingEnabled: false,
            transcriptStatus: 'FAILED',
          },
        });
        break;
      }
      case 'track_egress.started': {
        // A per-participant audio track egress began. This keeps the
        // pending-transcript counter up so extraction waits for everyone.
        await this.struggleSignals.onParticipantTrackEgressStarted(meeting.id);
        break;
      }
      case 'track_egress.ended': {
        const location = event.egressInfo?.fileResults?.[0]?.location;
        if (!location) {
          await this.struggleSignals.onParticipantTrackEgressFinished(
            meeting.id,
          );
          break;
        }
        const storageKey = this.storageKeyFromLocation(location);
        // Per-participant files carry the join-token identity in the path;
        // fall back to the event's participant identity if unavailable.
        const userId =
          this.userIdFromTrackStorageKey(storageKey) ??
          event.participant?.identity;
        if (!userId) {
          this.logger.warn(
            `[livekit-webhook] track_egress.ended without a participant for ${roomName}, skipping transcript`,
          );
          break;
        }
        void this.transcriptService
          .transcribeParticipantTrack(meeting.id, userId, storageKey)
          .catch((err: Error) =>
            this.logger.error(
              `[livekit-webhook] participant transcript failed for ${userId}: ${err?.message}`,
            ),
          );
        break;
      }
      case 'track_egress.failed': {
        // Count it closed so extraction is not blocked forever on a
        // corrupted upload; the student simply ends up without segments.
        await this.struggleSignals.onParticipantTrackEgressFinished(meeting.id);
        break;
      }
      default:
        this.logger.debug(`[livekit-webhook] ${event.event} (no handler)`);
    }
  }

  // ─── Internal helpers ─────────────────────────────────

  /** Live-join access: CLASS = offering teacher or currently enrolled
   *  student; AD_HOC = on the explicit participant list (host included). */
  private canJoin(user: User, meeting: MeetingWithRelations): boolean {
    if (meeting.createdBy === user.id) return true;
    if (meeting.type === 'CLASS') {
      const offering = meeting.courseOffering;
      if (!offering) return false;
      if (offering.teacherId === user.id) return true;
      return (
        user.role === 'STUDENT' &&
        offering.section.enrollments.some(
          (e) => e.studentId === user.id && e.status === 'APPROVED',
        )
      );
    }
    // AD_HOC: explicit participant list (host already covered above).
    return meeting.participants.some((p) => p.userId === user.id);
  }

  private isHost(user: User, meeting: MeetingWithRelations): boolean {
    if (meeting.createdBy === user.id) return true;
    // The current teacher of the offering can also host a CLASS meeting.
    return (
      meeting.type === 'CLASS' && meeting.courseOffering?.teacherId === user.id
    );
  }

  /** Prisma where fragment restricting a meeting query to what the caller
   *  is allowed to see — one expression, reused by list/find/detail. */
  private visibilityWhere(user: User): Prisma.MeetingWhereInput {
    switch (user.role) {
      case 'ADMIN':
        return {};
      case 'TEACHER':
        return {
          OR: [
            { type: 'CLASS', courseOffering: { teacherId: user.id } },
            { createdBy: user.id },
            { participants: { some: { userId: user.id } } },
          ],
        };
      case 'STUDENT':
        return {
          OR: [
            {
              type: 'CLASS',
              courseOffering: {
                section: {
                  enrollments: {
                    some: {
                      studentId: user.id,
                      status: 'APPROVED',
                    },
                  },
                },
              },
            },
            { participants: { some: { userId: user.id } } },
          ],
        };
      case 'GUARDIAN':
        return { participants: { some: { userId: user.id } } };
      default:
        return { id: '00000000-0000-0000-0000-000000000000' };
    }
  }

  /** Org-scoped fetch with the visibility predicate applied; returns null
   *  when the caller must not know the meeting exists. */
  private async findForUser(
    user: User,
    meetingId: string,
  ): Promise<MeetingWithRelations | null> {
    return this.prisma.meeting.findFirst({
      where: {
        id: meetingId,
        organizationId: user.organizationId ?? undefined,
        ...this.visibilityWhere(user),
      },
      include: meetingInclude,
    });
  }

  private toSummary(user: User, meeting: MeetingWithRelations) {
    return {
      id: meeting.id,
      title: meeting.title,
      type: meeting.type,
      status: meeting.status,
      transcriptStatus:
        (meeting._count?.transcripts ?? 0) > 0
          ? 'READY'
          : meeting.transcriptStatus,
      courseOfferingId: meeting.courseOfferingId,
      courseName: meeting.courseOffering?.course?.name ?? null,
      sectionName: meeting.courseOffering?.section?.name ?? null,
      scheduledStart: meeting.scheduledStart.toISOString(),
      scheduledEnd: meeting.scheduledEnd.toISOString(),
      recordingEnabled: meeting.recordingEnabled,
      recordingUrl: meeting.recordingUrl,
      createdBy: meeting.createdBy,
      hostName: meeting.createdByUser.name,
      participantCount: meeting.participants.length,
      isHost: this.isHost(user, meeting),
      canJoin: this.canJoin(user, meeting),
    };
  }

  private toDetail(user: User, meeting: MeetingWithRelations) {
    return {
      ...this.toSummary(user, meeting),
      participants: meeting.participants.map((p) => ({
        userId: p.userId,
        name: p.user.name,
      })),
      attendance: meeting.attendance.map((a) => ({
        userId: a.userId,
        name: a.user.name,
        joinedAt: a.joinedAt.toISOString(),
        leftAt: a.leftAt?.toISOString() ?? null,
      })),
    };
  }

  private async signedUrl(path: string): Promise<string> {
    const { data, error } = await this.supabase
      .getStorageClient()
      .storage.from(process.env.SUPABASE_STORAGE_BUCKET ?? 'materials')
      .createSignedUrl(path, 3600);
    if (error || !data) {
      throw new NotFoundException(
        'The recording file could not be retrieved from storage.',
      );
    }
    return data.signedUrl;
  }

  private async meetingsSignedUrl(path: string): Promise<string> {
    const bucket = process.env.SUPABASE_MEETINGS_BUCKET ?? 'meetings';
    const { data, error } = await this.supabase
      .getStorageClient()
      .storage.from(bucket)
      .createSignedUrl(path, 3600);
    if (error || !data) {
      throw new NotFoundException(
        'The recording file could not be retrieved from storage.',
      );
    }
    return data.signedUrl;
  }

  private toChatMessage(message: {
    id: string;
    meetingId: string;
    userId: string;
    text: string;
    createdAt: Date;
    user: { name: string };
  }) {
    return {
      id: message.id,
      meetingId: message.meetingId,
      userId: message.userId,
      name: message.user.name,
      text: message.text,
      createdAt: message.createdAt.toISOString(),
    };
  }

  /** LiveKit reports the S3 object location as a URL-ish string; reduce it
   *  to the bare storage key (what Supabase signed URLs expect). */
  private storageKeyFromLocation(location: string): string {
    const stripped = location
      .replace(/^s3:\/\/[^/]+\//, '')
      .replace(/^https?:\/\/[^/]+/, '');
    const segments = stripped.split('/').filter(Boolean);
    if (segments[0] === (process.env.SUPABASE_MEETINGS_BUCKET ?? 'meetings')) {
      segments.shift();
    }
    return segments.join('/');
  }

  /** Participant track keys are written as
   *  meetings/{room}/tracks/{participant_identity}/{track_id}-{time}.ogg
   *  where the identity is the join-token userId. */
  private userIdFromTrackStorageKey(storageKey: string): string | undefined {
    return storageKey.match(/tracks\/([^/]+)\//)?.[1];
  }
}
