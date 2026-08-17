import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { MeetingsService } from './meetings.service';
import { MeetingsController } from './meetings.controller';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService } from '../auth/supabase.service';
import { LivekitService } from './livekit.service';
import { TranscriptService } from './transcript.service';
import { StruggleSignalsService } from '../struggle-signals/struggle-signals.service';
import { MeetingEventsGateway } from './meeting-events.gateway';
import type { CreateMeetingInput } from './dto';
import type { User } from '@prisma/client';

jest.mock('livekit-server-sdk', () => ({
  AccessToken: jest.fn().mockImplementation(() => ({
    addGrant: jest.fn(),
    toJwt: jest.fn().mockResolvedValue('signed-livekit-jwt'),
  })),
}));

const rolesOn = (method: string) => {
  const meta: unknown = Reflect.getMetadata(
    'roles',
    MeetingsController.prototype[
      method as keyof typeof MeetingsController.prototype
    ],
  );
  return meta as string[];
};

/** First argument of the n-th call to a jest mock, typed by the caller —
 *  keeps the strict `no-unsafe-*` rules satisfied in assertions. */
const callArg = <T>(
  m: { mock: { calls: unknown[][] } },
  index = 0,
): T | undefined => m.mock.calls[index]?.[0] as T;

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const OFFERING_A = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const OFFERING_B = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

const teacher = {
  id: 'teacher-1',
  organizationId: ORG_A,
  role: 'TEACHER',
  name: 'Ms. A',
} as unknown as User;
const otherTeacher = {
  id: 'teacher-2',
  organizationId: ORG_A,
  role: 'TEACHER',
  name: 'Mr. B',
} as unknown as User;
const student = {
  id: 'student-1',
  organizationId: ORG_A,
  role: 'STUDENT',
  name: 'Ali',
} as unknown as User;
const strangerStudent = {
  id: 'student-2',
  organizationId: ORG_A,
  role: 'STUDENT',
  name: 'Sara',
} as unknown as User;
const admin = {
  id: 'admin-1',
  organizationId: ORG_A,
  role: 'ADMIN',
  name: 'Admin',
} as unknown as User;
const guardian = {
  id: 'guardian-1',
  organizationId: ORG_A,
  role: 'GUARDIAN',
  name: 'Guardian',
} as unknown as User;
const foreignUser = {
  id: 'foreign-1',
  organizationId: ORG_B,
  role: 'STUDENT',
  name: 'Outsider',
} as unknown as User;

const mockStorageBucket = {
  createSignedUrl: jest.fn(),
};
const mockSupabase = {
  getStorageClient: jest.fn(() => ({
    storage: { from: jest.fn(() => mockStorageBucket) },
  })),
};

const mockPrisma = {
  courseOffering: { findFirst: jest.fn() },
  user: { findMany: jest.fn() },
  meeting: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  meetingAttendance: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  meetingChatMessage: {
    create: jest.fn(),
    findMany: jest.fn(),
  },
  meetingTranscript: {
    createMany: jest.fn(),
    findMany: jest.fn(),
  },
};

const baseMeeting = (overrides: Record<string, any> = {}) => ({
  id: 'meeting-1',
  organizationId: ORG_A,
  title: 'Algebra review',
  type: 'CLASS',
  courseOfferingId: OFFERING_A,
  createdBy: teacher.id,
  scheduledStart: new Date('2026-08-10T09:00:00Z'),
  scheduledEnd: new Date('2026-08-10T09:45:00Z'),
  status: 'SCHEDULED',
  roomName: 'meeting-abc',
  recordingEnabled: false,
  recordingUrl: null,
  recordingEgressId: null,
  transcriptStatus: 'PENDING',
  createdAt: new Date(),
  courseOffering: {
    id: OFFERING_A,
    teacherId: teacher.id,
    course: { name: 'Algebra' },
    section: {
      name: 'Grade 9A',
      enrollments: [
        { studentId: student.id, status: 'APPROVED' },
        { studentId: strangerStudent.id, status: 'PENDING' },
      ],
    },
  },
  createdByUser: { name: teacher.name },
  participants: [] as any[],
  attendance: [] as any[],
  ...overrides,
});

describe('MeetingsService', () => {
  let service: MeetingsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MeetingsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SupabaseService, useValue: mockSupabase },
        {
          provide: LivekitService,
          useValue: {
            ensureRoom: jest.fn(),
            startRecording: jest.fn(),
            stopRecording: jest.fn(),
          },
        },

        {
          provide: TranscriptService,
          useValue: {
            transcribe: jest.fn(),
            transcribeParticipantTrack: jest.fn(),
          },
        },
        {
          provide: StruggleSignalsService,
          useValue: {
            onParticipantTrackEgressStarted: jest.fn(),
            onParticipantTrackEgressFinished: jest.fn(),
            finalizeStruggleExtraction: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: MeetingEventsGateway,
          useValue: {
            broadcastMessage: jest.fn(),
            broadcastTranscript: jest.fn(),
          },
        },
      ],
    }).compile();
    service = module.get(MeetingsService);
  });

  // ─── Create ──────────────────────────────────────────
  it('creates a CLASS meeting when the teacher owns the offering', async () => {
    mockPrisma.courseOffering.findFirst.mockResolvedValue({
      id: OFFERING_A,
      teacherId: teacher.id,
    });

    mockPrisma.meeting.create.mockResolvedValue(baseMeeting());

    const dto: CreateMeetingInput = {
      title: 'Algebra review',
      type: 'CLASS',
      courseOfferingId: OFFERING_A,
      scheduledStart: '2026-08-10T09:00:00.000Z',
      scheduledEnd: '2026-08-10T09:45:00.000Z',
      recordingEnabled: false,
    };
    const result = await service.create(teacher, dto);
    expect(result.title).toBe('Algebra review');
    const arg = callArg<{ data?: { roomName?: string; createdBy?: string } }>(
      mockPrisma.meeting.create,
    );
    expect(arg?.data?.roomName).toMatch(/^meeting-/);
    expect(arg?.data?.createdBy).toBe(teacher.id);
  });

  it('rejects a TEACHER creating a CLASS meeting for an offering they do not teach', async () => {
    mockPrisma.courseOffering.findFirst.mockResolvedValue({
      id: OFFERING_A,
      teacherId: teacher.id,
    });

    const dto: CreateMeetingInput = {
      title: 'Hijack',
      type: 'CLASS',
      courseOfferingId: OFFERING_A,
      scheduledStart: '2026-08-10T09:00:00.000Z',
      scheduledEnd: '2026-08-10T09:45:00.000Z',
      recordingEnabled: false,
    };
    await expect(service.create(otherTeacher, dto)).rejects.toThrow(
      ForbiddenException,
    );
    expect(mockPrisma.meeting.create).not.toHaveBeenCalled();
  });

  it('rejects STUDENT and GUARDIAN creation at the guard level', () => {
    expect(rolesOn('create')).toEqual(['TEACHER', 'ADMIN']);
    expect(rolesOn('join')).toContain('STUDENT');
    expect(rolesOn('end')).toEqual(['TEACHER', 'ADMIN']);
    expect(rolesOn('setRecording')).toEqual(['TEACHER', 'ADMIN']);
  });

  it('creates an AD_HOC meeting with an explicit participant list (admin)', async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      { id: teacher.id },
      { id: student.id },
    ]);
    mockPrisma.meeting.create.mockResolvedValue(
      baseMeeting({
        type: 'AD_HOC',
        courseOfferingId: null,
        participants: [
          { userId: student.id, user: student },
          { userId: teacher.id, user: teacher },
        ],
      }),
    );

    const dto: CreateMeetingInput = {
      title: 'Staff sync',
      type: 'AD_HOC',
      scheduledStart: '2026-08-10T10:00:00.000Z',
      scheduledEnd: '2026-08-10T10:30:00.000Z',
      recordingEnabled: false,
      participantIds: [teacher.id, student.id],
    };
    const result = await service.create(admin, dto);
    expect(result.type).toBe('AD_HOC');
    expect(
      callArg<{ data: { roomName?: unknown; createdBy?: string } }>(
        mockPrisma.meeting.create,
      ),
    ).toMatchObject({
      data: {
        participants: {
          create: [{ userId: teacher.id }, { userId: student.id }],
        },
      },
    });
  });

  it('rejects AD_HOC creation when a participant is outside the organization', async () => {
    mockPrisma.user.findMany.mockResolvedValue([{ id: teacher.id }]);
    const dto: CreateMeetingInput = {
      title: 'Leak',
      type: 'AD_HOC',
      scheduledStart: '2026-08-10T10:00:00.000Z',
      scheduledEnd: '2026-08-10T10:30:00.000Z',
      participantIds: [teacher.id, foreignUser.id],
      recordingEnabled: false,
    };
    await expect(service.create(admin, dto)).rejects.toThrow(NotFoundException);
  });

  it('blocks cross-organization creation (offering lives in org B)', async () => {
    mockPrisma.courseOffering.findFirst.mockResolvedValue(null); // org-scoped query misses
    const dto: CreateMeetingInput = {
      title: 'X',
      type: 'CLASS',
      courseOfferingId: OFFERING_B,
      scheduledStart: '2026-08-10T09:00:00.000Z',
      scheduledEnd: '2026-08-10T09:45:00.000Z',
      recordingEnabled: false,
    };
    await expect(service.create(foreignUser, dto)).rejects.toThrow(
      NotFoundException,
    );
    expect(
      callArg<{ where?: { organizationId?: string } }>(
        mockPrisma.courseOffering.findFirst,
      ),
    ).toMatchObject({ where: { organizationId: ORG_B } });
  });

  // ─── Join (token issuance) ───────────────────────────
  it('issues a token to an enrolled student of a CLASS meeting', async () => {
    mockPrisma.meeting.findFirst.mockResolvedValue(baseMeeting());
    mockPrisma.meetingAttendance.findFirst.mockResolvedValue(null);
    mockPrisma.meetingAttendance.create.mockResolvedValue({ id: 'att-1' });
    mockPrisma.meeting.update.mockResolvedValue(
      baseMeeting({ status: 'LIVE' }),
    );

    const result = await service.join(student, 'meeting-1');
    expect(result.token).toBe('signed-livekit-jwt');
    expect(result.roomName).toBe('meeting-abc');
    expect(result.identity).toBe(student.id);
    expect(
      callArg<{ data?: { meetingId?: string; userId?: string } }>(
        mockPrisma.meetingAttendance.create,
      ),
    ).toMatchObject({ data: { meetingId: 'meeting-1', userId: student.id } });
    expect(
      callArg<{ where?: { id?: string }; data?: { status?: string } }>(
        mockPrisma.meeting.update,
      ),
    ).toMatchObject({
      where: { id: 'meeting-1' },
      data: { status: 'LIVE' },
    });
  });

  it('rejects a student NOT enrolled in the CLASS meeting section (no token)', async () => {
    mockPrisma.meeting.findFirst.mockResolvedValue(baseMeeting());
    await expect(service.join(strangerStudent, 'meeting-1')).rejects.toThrow(
      ForbiddenException,
    );
    expect(mockPrisma.meetingAttendance.create).not.toHaveBeenCalled();
  });

  it('rejects a GUARDIAN joining a CLASS meeting', async () => {
    mockPrisma.meeting.findFirst.mockResolvedValue(baseMeeting());
    await expect(service.join(guardian, 'meeting-1')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('rejects a user NOT on the AD_HOC participant list', async () => {
    mockPrisma.meeting.findFirst.mockResolvedValue(
      baseMeeting({
        type: 'AD_HOC',
        courseOfferingId: null,
        participants: [{ userId: student.id, user: student }],
      }),
    );
    await expect(service.join(strangerStudent, 'meeting-1')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('lets the AD_HOC host join even without a participant row', async () => {
    mockPrisma.meeting.findFirst.mockResolvedValue(
      baseMeeting({
        type: 'AD_HOC',
        courseOfferingId: null,
        createdBy: admin.id,
        participants: [{ userId: student.id, user: student }],
      }),
    );
    mockPrisma.meetingAttendance.findFirst.mockResolvedValue(null);
    mockPrisma.meetingAttendance.create.mockResolvedValue({ id: 'att-2' });
    mockPrisma.meeting.update.mockResolvedValue({});
    const result = await service.join(admin, 'meeting-1');
    expect(result.token).toBe('signed-livekit-jwt');
  });

  it('lets a student enrolled AFTER the meeting was created still join (live roster)', async () => {
    // Meeting was created before the student joined the section — the roster
    // is derived at join time, so findForUser resolves it from the current
    // enrollments, not a snapshot taken at creation.
    mockPrisma.meeting.findFirst.mockResolvedValue(
      baseMeeting({
        courseOffering: {
          id: OFFERING_A,
          teacherId: teacher.id,
          course: { name: 'Algebra' },
          section: {
            name: 'Grade 9A',
            enrollments: [
              { studentId: strangerStudent.id, status: 'APPROVED' },
            ],
          },
        },
      }),
    );
    mockPrisma.meetingAttendance.findFirst.mockResolvedValue(null);
    mockPrisma.meetingAttendance.create.mockResolvedValue({ id: 'att-3' });
    mockPrisma.meeting.update.mockResolvedValue({});

    const result = await service.join(strangerStudent, 'meeting-1');
    expect(result.token).toBe('signed-livekit-jwt');
  });

  it('refuses a token for a meeting in another organization', async () => {
    mockPrisma.meeting.findFirst.mockResolvedValue(null); // org-scoped visibility
    await expect(service.join(foreignUser, 'meeting-1')).rejects.toThrow(
      NotFoundException,
    );
    expect(
      callArg<{ where?: { organizationId?: string } }>(
        mockPrisma.meeting.findFirst,
      ),
    ).toMatchObject({
      where: { organizationId: ORG_B },
    });
  });

  it('refuses a token for an ENDED or CANCELED meeting', async () => {
    mockPrisma.meeting.findFirst.mockResolvedValue(
      baseMeeting({ status: 'ENDED' }),
    );
    await expect(service.join(student, 'meeting-1')).rejects.toThrow(
      ForbiddenException,
    );
  });

  // ─── Leave / End ─────────────────────────────────────
  it('marks attendance as left on leave', async () => {
    mockPrisma.meeting.findFirst.mockResolvedValue(baseMeeting());
    mockPrisma.meetingAttendance.updateMany.mockResolvedValue({ count: 1 });
    const result = await service.leave(student, 'meeting-1');
    expect(result.leftAt).toBeTruthy();
    expect(
      callArg<{
        where?: { meetingId?: string; userId?: string; leftAt?: unknown };
      }>(mockPrisma.meetingAttendance.updateMany),
    ).toMatchObject({
      where: { meetingId: 'meeting-1', userId: student.id, leftAt: null },
    });
  });

  it('ends a meeting (host only) and rejects non-hosts', async () => {
    mockPrisma.meeting.findFirst.mockResolvedValue(baseMeeting());
    mockPrisma.meeting.update.mockResolvedValue(
      baseMeeting({ status: 'ENDED' }),
    );
    const result = await service.end(teacher, 'meeting-1');
    expect(result.status).toBe('ENDED');

    jest.clearAllMocks();
    mockPrisma.meeting.findFirst.mockResolvedValue(baseMeeting());
    await expect(service.end(student, 'meeting-1')).rejects.toThrow(
      ForbiddenException,
    );
    expect(mockPrisma.meeting.update).not.toHaveBeenCalled();
  });

  it('allows the current offering teacher to end a CLASS meeting', async () => {
    mockPrisma.meeting.findFirst.mockResolvedValue(
      baseMeeting({
        courseOffering: {
          id: OFFERING_A,
          teacherId: otherTeacher.id,
          course: { name: 'Algebra' },
          section: {
            name: 'Grade 9A',
            enrollments: [{ studentId: student.id, status: 'APPROVED' }],
          },
        },
      }),
    );
    mockPrisma.meeting.update.mockResolvedValue(
      baseMeeting({ status: 'ENDED' }),
    );
    const result = await service.end(otherTeacher, 'meeting-1');
    expect(result.status).toBe('ENDED');
  });

  // ─── Recording toggle ────────────────────────────────
  it('toggles recording only for the host', async () => {
    mockPrisma.meeting.findFirst.mockResolvedValue(baseMeeting());
    mockPrisma.meeting.update.mockResolvedValue(
      baseMeeting({ recordingEnabled: true }),
    );
    const result = await service.setRecording(teacher, 'meeting-1', true);
    expect(result.recordingEnabled).toBe(true);

    jest.clearAllMocks();
    mockPrisma.meeting.findFirst.mockResolvedValue(baseMeeting());
    await expect(
      service.setRecording(student, 'meeting-1', true),
    ).rejects.toThrow(ForbiddenException);
  });

  // ─── Recording playback (Phase 3 permission parity) ──
  it('gives the recording URL to someone allowed in the room', async () => {
    mockPrisma.meeting.findFirst.mockResolvedValue(
      baseMeeting({ recordingUrl: 'materials/meetings/rec.mp4' }),
    );
    mockStorageBucket.createSignedUrl.mockResolvedValue({
      data: { signedUrl: 'https://signed/rec.mp4' },
      error: null,
    });
    const result = await service.getRecording(student, 'meeting-1');
    expect(result.recordingUrl).toBe('https://signed/rec.mp4');
  });

  it('rejects recording access for a user who could not have joined', async () => {
    mockPrisma.meeting.findFirst.mockResolvedValue(baseMeeting());
    await expect(
      service.getRecording(strangerStudent, 'meeting-1'),
    ).rejects.toThrow(ForbiddenException);
    expect(mockStorageBucket.createSignedUrl).not.toHaveBeenCalled();
  });

  it('hides the meeting entirely (404) for a user in another organization', async () => {
    mockPrisma.meeting.findFirst.mockResolvedValue(null);
    await expect(
      service.getRecording(foreignUser, 'meeting-1'),
    ).rejects.toThrow(NotFoundException);
  });

  // ─── List scoping ────────────────────────────────────
  it('scopes lists per role and organization', async () => {
    mockPrisma.meeting.findMany.mockResolvedValue([baseMeeting()]);
    await service.list(student, 'upcoming');
    expect(
      callArg<{ where?: { organizationId?: string; OR?: unknown } }>(
        mockPrisma.meeting.findMany,
      ),
    ).toMatchObject({
      where: { organizationId: ORG_A },
    });

    jest.clearAllMocks();
    mockPrisma.meeting.findMany.mockResolvedValue([]);
    const guardianResult = await service.list(guardian, 'all');
    expect(guardianResult.meetings).toEqual([]);
  });

  it('does not expose meetings the caller cannot see', async () => {
    mockPrisma.meeting.findMany.mockResolvedValue([]);
    const result = await service.list(foreignUser, 'all');
    expect(result.meetings).toEqual([]);
    const arg = callArg<{
      where?: { organizationId?: string; AND?: { OR?: unknown[] }[] };
    }>(mockPrisma.meeting.findMany);
    expect(arg?.where?.organizationId).toBe(ORG_B);
    expect(Array.isArray(arg?.where?.AND?.[0]?.OR)).toBe(true);
  });

  it('self-heals stale LIVE meetings (no room_finished webhook) on list', async () => {
    mockPrisma.meeting.findMany.mockResolvedValue([]);
    mockPrisma.meeting.updateMany.mockResolvedValue({ count: 2 });
    await service.list(teacher, 'upcoming');
    const updateManyCalls = mockPrisma.meeting.updateMany.mock.calls as [
      { data: { status: string }; where: Record<string, unknown> },
    ][];
    expect(updateManyCalls[0][0].data).toEqual({ status: 'ENDED' });
    expect(updateManyCalls[0][0].where).toEqual(
      expect.objectContaining({ status: 'LIVE' }),
    );
  });

  it('includes overrunning LIVE meetings in the upcoming scope', async () => {
    mockPrisma.meeting.findMany.mockResolvedValue([]);
    await service.list(teacher, 'upcoming');
    const arg = callArg<{
      where?: { AND?: { OR?: unknown[] }[] };
    }>(mockPrisma.meeting.findMany);
    const scope = arg?.where?.AND?.[1];
    expect(scope?.OR).toEqual(expect.arrayContaining([{ status: 'LIVE' }]));
  });

  // ─── LiveKit webhook: room_finished guard ─────────────
  it('ignores room_finished for a meeting whose scheduled start has not arrived', async () => {
    mockPrisma.meeting.findUnique.mockResolvedValue(
      baseMeeting({
        scheduledStart: new Date(Date.now() + 60 * 60 * 1000),
        status: 'SCHEDULED',
      }),
    );
    await service.handleLivekitEvent({
      event: 'room_finished',
      room: { name: 'meeting-abc' },
    } as never);
    expect(mockPrisma.meeting.update).not.toHaveBeenCalled();
  });

  it('marks room_finished meetings ENDED once the scheduled start has passed', async () => {
    mockPrisma.meeting.findUnique.mockResolvedValue(
      baseMeeting({
        scheduledStart: new Date(Date.now() - 60 * 60 * 1000),
        status: 'LIVE',
      }),
    );
    mockPrisma.meeting.update.mockResolvedValue(baseMeeting());
    mockPrisma.meetingAttendance.updateMany.mockResolvedValue({ count: 0 });
    await service.handleLivekitEvent({
      event: 'room_finished',
      room: { name: 'meeting-abc' },
    } as never);
    expect(mockPrisma.meeting.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'ENDED' },
      }),
    );
  });
});
