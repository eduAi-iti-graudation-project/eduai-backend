import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// ─── Enums ──────────────────────────────────────────────
export const MeetingTypeSchema = z.enum(['CLASS', 'AD_HOC']);
export const MeetingStatusSchema = z.enum([
  'SCHEDULED',
  'LIVE',
  'ENDED',
  'CANCELED',
]);
export const TranscriptStatusSchema = z.enum([
  'PENDING',
  'PROCESSING',
  'READY',
  'FAILED',
]);

// ─── Create ─────────────────────────────────────────────
export const CreateMeetingSchema = z
  .object({
    title: z.string().min(1).max(200),
    type: MeetingTypeSchema,
    // Required for CLASS meetings; must be a CourseOffering the caller teaches.
    courseOfferingId: z.string().uuid().optional(),
    scheduledStart: z.iso.datetime(),
    scheduledEnd: z.iso.datetime(),
    // Recording is strictly opt-in, per meeting, set by the host at creation
    // or from within the call. Defaults to OFF.
    recordingEnabled: z.boolean().optional().default(false),
    // Explicit invite list for AD_HOC meetings (same-organization user IDs).
    participantIds: z.array(z.string().uuid()).min(1).optional(),
  })
  .refine((d) => d.scheduledStart < d.scheduledEnd, {
    message: 'scheduledEnd must be after scheduledStart',
    path: ['scheduledEnd'],
  })
  .refine(
    (d) =>
      d.type === 'CLASS'
        ? !!d.courseOfferingId
        : d.courseOfferingId === undefined,
    {
      message:
        'courseOfferingId is required for CLASS meetings and forbidden for AD_HOC',
      path: ['courseOfferingId'],
    },
  )
  .refine(
    (d) =>
      d.type === 'AD_HOC'
        ? (d.participantIds?.length ?? 0) > 0
        : d.participantIds === undefined,
    {
      message:
        'participantIds is required for AD_HOC meetings and forbidden for CLASS',
      path: ['participantIds'],
    },
  );

export const UpdateRecordingSchema = z.object({
  enabled: z.boolean(),
});

export const SendChatMessageSchema = z.object({
  text: z.string().min(1).max(2000),
});

const ChatMessageResponseSchema = z.object({
  id: z.string().uuid(),
  meetingId: z.string().uuid(),
  userId: z.string().uuid(),
  name: z.string(),
  text: z.string(),
  createdAt: z.string(),
});

const ChatHistoryResponseSchema = z.object({
  messages: z.array(ChatMessageResponseSchema),
});

const TranscriptSegmentSchema = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  text: z.string(),
});

const TranscriptResponseSchema = z.object({
  status: TranscriptStatusSchema,
  segments: z.array(TranscriptSegmentSchema),
});

// ─── Responses ──────────────────────────────────────────
const MeetingParticipantResponseSchema = z.object({
  userId: z.string().uuid(),
  name: z.string(),
});

const MeetingAttendanceResponseSchema = z.object({
  userId: z.string().uuid(),
  name: z.string(),
  joinedAt: z.string(),
  leftAt: z.string().nullable(),
});

export const MeetingSummarySchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  type: MeetingTypeSchema,
  status: MeetingStatusSchema,
  transcriptStatus: TranscriptStatusSchema,
  courseOfferingId: z.string().uuid().nullable(),
  courseName: z.string().nullable(),
  sectionName: z.string().nullable(),
  scheduledStart: z.string(),
  scheduledEnd: z.string(),
  recordingEnabled: z.boolean(),
  recordingUrl: z.string().nullable(),
  createdBy: z.string().uuid(),
  hostName: z.string(),
  participantCount: z.number(),
  isHost: z.boolean(),
  canJoin: z.boolean(),
});

export const MeetingDetailSchema = MeetingSummarySchema.extend({
  participants: z.array(MeetingParticipantResponseSchema),
  attendance: z.array(MeetingAttendanceResponseSchema),
});

export const MeetingListSchema = z.object({
  meetings: z.array(MeetingSummarySchema),
});

export const JoinMeetingSchema = z.object({
  token: z.string(),
  url: z.string(),
  roomName: z.string(),
  identity: z.string().uuid(),
});

export const LeaveMeetingSchema = z.object({
  leftAt: z.string(),
});

export const RecordingResponseSchema = z.object({
  recordingUrl: z.string(),
});

export const SaveTranscriptSegmentSchema = z.object({
  startMs: z.number().int().nonnegative().optional().default(0),
  endMs: z.number().int().nonnegative().optional(),
  text: z.string(),
});

export const SaveTranscriptSchema = z.object({
  segments: z.array(SaveTranscriptSegmentSchema).default([]),
  replace: z.boolean().optional().default(false),
});

// ─── DTO Classes ────────────────────────────────────────
export class CreateMeetingDto extends createZodDto(CreateMeetingSchema) {}
export class UpdateRecordingDto extends createZodDto(UpdateRecordingSchema) {}
export class SendChatMessageDto extends createZodDto(SendChatMessageSchema) {}
export class SaveTranscriptDto extends createZodDto(SaveTranscriptSchema) {}
export class MeetingDetailDto extends createZodDto(MeetingDetailSchema) {}
export class MeetingListDto extends createZodDto(MeetingListSchema) {}
export class JoinMeetingDto extends createZodDto(JoinMeetingSchema) {}
export class LeaveMeetingDto extends createZodDto(LeaveMeetingSchema) {}
export class RecordingResponseDto extends createZodDto(
  RecordingResponseSchema,
) {}
export class ChatHistoryResponseDto extends createZodDto(
  ChatHistoryResponseSchema,
) {}
export class ChatMessageResponseDto extends createZodDto(
  ChatMessageResponseSchema,
) {}
export class TranscriptResponseDto extends createZodDto(
  TranscriptResponseSchema,
) {}

export type CreateMeetingInput = z.infer<typeof CreateMeetingSchema>;
