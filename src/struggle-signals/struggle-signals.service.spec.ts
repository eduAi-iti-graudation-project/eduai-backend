import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  StruggleSignalsService,
  similarConcepts,
  conceptSimilarity,
} from './struggle-signals.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderService } from '../common/ai/provider.service';
import { QuizzesService } from '../quizzes/quizzes.service';
import { HomeworkHelperAgent } from '../homework-helper/homework-helper.agent';
import { NotificationsService } from '../notifications/notifications.service';
import { ErrorCode } from '../common/errors/codes';
import type { User } from '@prisma/client';

/** n-th argument of the n-th call to a jest mock, typed by the caller —
 *  keeps the strict `no-unsafe-*` rules satisfied in assertions. */
const callArg = <T>(
  m: { mock: { calls: unknown[][] } },
  callIndex = 0,
  argIndex = 0,
): T | undefined => m.mock.calls[callIndex]?.[argIndex] as T;

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OFFERING_A = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const OFFERING_B = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const MEETING_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

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

const studentA = { id: 's-1', name: 'Ali', role: 'STUDENT' };
const studentB = { id: 's-2', name: 'Sara', role: 'STUDENT' };
const studentC = { id: 's-3', name: 'Omar', role: 'STUDENT' };
const silentStudent = { id: 's-4', name: 'Noor', role: 'STUDENT' };

const mockPrisma = {
  meeting: {
    update: jest.fn(),
    updateMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
  },
  meetingTranscriptSegment: { findMany: jest.fn() },
  user: { findMany: jest.fn() },
  struggleSignal: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    updateMany: jest.fn(),
  },
  courseOffering: { findUnique: jest.fn() },
  quiz: { update: jest.fn() },
};

const mockProvider = { chat: jest.fn() };
const mockQuizzes = { generate: jest.fn(), generateForConcept: jest.fn() };
const mockHomework = { help: jest.fn() };
const mockNotifications = { notifyUser: jest.fn() };

/** The fake gateway must answer with the JSON payload the extraction agent
 *  declares in its output schema (concept + explanation). */
const chatAnswer = (signals: { concept: string; explanation: string }[]) =>
  JSON.stringify({ signals });

const segment = (userId: string, timestamp: number, text: string) => ({
  id: `seg-${userId}-${timestamp}-${Math.random()}`,
  meetingId: MEETING_ID,
  userId,
  timestamp,
  text,
});

describe('StruggleSignalsService', () => {
  let service: StruggleSignalsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.struggleSignal.findMany.mockResolvedValue([]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StruggleSignalsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ProviderService, useValue: mockProvider },
        { provide: QuizzesService, useValue: mockQuizzes },
        { provide: HomeworkHelperAgent, useValue: mockHomework },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();
    service = module.get(StruggleSignalsService);
  });

  // ─── Egress bookkeeping ──────────────────────────────
  it('increments the pending-transcript counter when a track egress starts', async () => {
    await service.onParticipantTrackEgressStarted(MEETING_ID);
    expect(mockPrisma.meeting.update).toHaveBeenCalledWith({
      where: { id: MEETING_ID },
      data: { pendingParticipantTranscripts: { increment: 1 } },
    });
  });

  it('decrements (only while > 0) when a track egress finishes', async () => {
    mockPrisma.meeting.findUnique.mockResolvedValue({
      struggleSignalsProcessed: true,
    });
    await service.onParticipantTrackEgressFinished(MEETING_ID);
    expect(mockPrisma.meeting.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: MEETING_ID, pendingParticipantTranscripts: { gt: 0 } },
        data: { pendingParticipantTranscripts: { decrement: 1 } },
      }),
    );
  });

  // ─── Phase 1: extraction ─────────────────────────────

  it('runs one Mastra extraction call per speaking student and persists signals', async () => {
    const classMeeting = {
      id: MEETING_ID,
      type: 'CLASS',
      courseOfferingId: OFFERING_A,
      title: 'Algebra review',
      courseOffering: { course: { name: 'Algebra' } },
    };
    mockPrisma.meeting.findUnique.mockResolvedValue(classMeeting);
    mockPrisma.meetingTranscriptSegment.findMany.mockResolvedValue([
      segment(studentA.id, 10, 'Is the slope the rise over run?'),
      segment(studentB.id, 60, 'I keep mixing up the axes'),
      segment(studentA.id, 90, 'So y over x?'),
      segment('t-1', 100, 'Yes, keep going'),
    ]);
    mockPrisma.user.findMany.mockResolvedValue([
      studentA,
      studentB,
      silentStudent,
      { id: 't-1', name: 'Ms. A', role: 'TEACHER' },
    ]);
    mockProvider.chat.mockResolvedValue(
      chatAnswer([
        { concept: 'slope vs intercept', explanation: 'Mixing them up.' },
      ]),
    );
    mockPrisma.struggleSignal.create.mockResolvedValue({ id: 'sig-1' });

    await service.extractSignals(MEETING_ID);

    // Two speakers => exactly two gateway calls (Noor never spoke => none).
    expect(mockProvider.chat).toHaveBeenCalledTimes(2);
    expect(mockPrisma.struggleSignal.create).toHaveBeenCalledTimes(2);
    expect(mockPrisma.struggleSignal.create).toHaveBeenCalledWith({
      data: {
        meetingId: MEETING_ID,
        studentId: studentA.id,
        concept: 'slope vs intercept',
        explanation: 'Mixing them up.',
        status: 'PENDING',
      },
    });
  });

  it('never leaks real student identity into the model payload', async () => {
    const classMeeting = {
      id: MEETING_ID,
      type: 'CLASS',
      courseOfferingId: OFFERING_A,
      title: 'Algebra review',
      courseOffering: { course: { name: 'Algebra' } },
    };
    mockPrisma.meeting.findUnique.mockResolvedValue(classMeeting);
    mockPrisma.meetingTranscriptSegment.findMany.mockResolvedValue([
      segment(studentA.id, 10, 'Is the denominator the top one?'),
      segment(studentB.id, 80, 'I wrote it backwards I think'),
    ]);
    mockPrisma.user.findMany.mockResolvedValue([
      studentA,
      studentB,
      { id: 't-1', name: 'Ms. A', role: 'TEACHER' },
    ]);
    mockProvider.chat.mockResolvedValue(chatAnswer([]));

    await service.extractSignals(MEETING_ID);

    // chat(systemPrompt, userPrompt) — the user prompt is the payload.
    const calls = mockProvider.chat.mock.calls as unknown as [string, string][];
    const prompts = calls.map((c) => c[1]);

    // Deterministic placeholders, in sorted studentId order.
    expect(prompts[0]).toContain('Student_A: Is the denominator the top one?');
    expect(prompts[1]).toContain('Student_B: I wrote it backwards I think');
    for (const prompt of prompts) {
      expect(prompt).not.toContain('Ali');
      expect(prompt).not.toContain('Sara');
      expect(prompt).not.toContain(studentA.id);
      expect(prompt).not.toContain(studentB.id);
    }
  });

  it('only includes teacher context within the timestamp window', async () => {
    const classMeeting = {
      id: MEETING_ID,
      type: 'CLASS',
      courseOfferingId: OFFERING_A,
      title: 'Algebra review',
      courseOffering: { course: { name: 'Algebra' } },
    };
    mockPrisma.meeting.findUnique.mockResolvedValue(classMeeting);
    mockPrisma.meetingTranscriptSegment.findMany.mockResolvedValue([
      segment(studentA.id, 100, 'Hmm, the median of an even set?'),
      segment('t-1', 110, 'You average the two middle values.'),
      segment('t-1', 4000, 'Teacher: way later topic recap'),
    ]);
    mockPrisma.user.findMany.mockResolvedValue([
      studentA,
      { id: 't-1', name: 'Ms. A', role: 'TEACHER' },
    ]);
    mockProvider.chat.mockResolvedValue(chatAnswer([]));

    await service.extractSignals(MEETING_ID);

    const prompt = callArg<string>(mockProvider.chat, 0, 1);
    expect(prompt).toContain('the two middle values');
    expect(prompt).not.toContain('way later');
  });

  it('does nothing for ad-hoc meetings or empty transcripts', async () => {
    mockPrisma.meeting.findUnique.mockResolvedValue({
      id: MEETING_ID,
      type: 'AD_HOC',
      courseOfferingId: null,
      title: 'Quick chat',
    });
    await service.extractSignals(MEETING_ID);
    expect(mockProvider.chat).not.toHaveBeenCalled();

    mockPrisma.meeting.findUnique.mockResolvedValue({
      id: MEETING_ID,
      type: 'CLASS',
      courseOfferingId: OFFERING_A,
      title: 'Algebra review',
    });
    mockPrisma.meetingTranscriptSegment.findMany.mockResolvedValue([]);
    await service.extractSignals(MEETING_ID);
    expect(mockProvider.chat).not.toHaveBeenCalled();
  });

  it('rolls up the same concept shared by 3+ students as class-wide', async () => {
    const classMeeting = {
      id: MEETING_ID,
      type: 'CLASS',
      courseOfferingId: OFFERING_A,
      title: 'Algebra review',
      courseOffering: { course: { name: 'Algebra' } },
    };
    mockPrisma.meeting.findUnique.mockResolvedValue(classMeeting);
    mockPrisma.meetingTranscriptSegment.findMany.mockResolvedValue([
      segment(studentA.id, 10, 'Wait, is the slope rise over run?'),
      segment(studentB.id, 40, 'Slope is rise over run, right?'),
      segment(studentC.id, 70, 'Rise over run, or run over rise?'),
      segment('s-5', 100, 'Unrelated: what is a quadratic?'),
    ]);
    mockPrisma.user.findMany.mockResolvedValue([
      studentA,
      studentB,
      studentC,
      { id: 's-5', name: 'Lina', role: 'STUDENT' },
    ]);
    mockProvider.chat.mockImplementation(() =>
      Promise.resolve(
        chatAnswer([{ concept: 'slope is rise over run', explanation: 'x' }]),
      ),
    );
    mockPrisma.struggleSignal.create.mockImplementation(
      ({ data }: { data: { concept: string } }) =>
        ({ id: `sig-${data.concept}` }) as never,
    );
    mockPrisma.struggleSignal.findMany.mockResolvedValue([
      {
        id: 'sig-a',
        studentId: studentA.id,
        concept: 'slope is rise over run',
      },
      {
        id: 'sig-b',
        studentId: studentB.id,
        concept: 'slope is rise over run',
      },
      {
        id: 'sig-c',
        studentId: studentC.id,
        concept: 'slope is rise over run',
      },
      // Unrelated individual concept stays individual.
      { id: 'sig-d', studentId: 's-5', concept: 'quadratic formula' },
    ]);
    mockPrisma.struggleSignal.updateMany.mockResolvedValue({ count: 3 });

    await service.extractSignals(MEETING_ID);

    const rollupCalls = mockPrisma.struggleSignal.updateMany.mock
      .calls as unknown as [
      { where: { id: { in: string[] } }; data: { classWide?: boolean } },
    ][];
    const rollupCall = rollupCalls.find((c) => c[0].data.classWide);
    expect(rollupCall).toBeDefined();
    const ids = rollupCall?.[0].where.id.in;
    // All three students flagged for the same concept => class-wide; the
    // s-5 quadratic stays individual.
    expect(ids).toEqual(expect.arrayContaining(['sig-a', 'sig-b', 'sig-c']));
    expect(ids).not.toContain('sig-d');
  });

  it('never marks a concept class-wide for fewer than 3 students', () => {
    // Two students say nearly the same thing — deterministic matcher sees
    // the similarity but the 3-student threshold keeps it individual.
    expect(similarConcepts('gas vs plasma', 'gas and plasma')).toBe(false);
    expect(conceptSimilarity('gas vs plasma', 'gas and plasma')).toBeLessThan(
      0.6,
    );
    expect(
      similarConcepts('states of matter', 'states of matter and processes'),
    ).toBe(true);
  });

  // ─── Phase 2: review & dispatch ──────────────────────

  const ownMeeting = {
    id: MEETING_ID,
    type: 'CLASS',
    courseOfferingId: OFFERING_A,
    courseOffering: { teacherId: teacher.id },
  };

  it('rejects non-teacher access to a meeting’s signals', async () => {
    mockPrisma.meeting.findFirst.mockResolvedValue(ownMeeting);
    await expect(
      service.getSignalsForMeeting(otherTeacher, MEETING_ID),
    ).rejects.toThrow(ForbiddenException);
  });

  it('hides meetings outside the caller’s organization', async () => {
    mockPrisma.meeting.findFirst.mockResolvedValue(null);
    await expect(
      service.getSignalsForMeeting(teacher, MEETING_ID),
    ).rejects.toThrow(NotFoundException);
  });

  it('splits pending class-wide clusters, individual signals, and history', async () => {
    mockPrisma.meeting.findFirst.mockResolvedValue(ownMeeting);
    const signals = [
      {
        id: 'sig-1',
        studentId: studentA.id,
        student: { id: studentA.id, name: studentA.name },
        concept: 'states of matter',
        explanation: '…',
        status: 'PENDING',
        classWide: true,
        quizId: null,
        interactionId: null,
        createdAt: new Date('2026-08-01T10:00:00Z'),
      },
      {
        id: 'sig-2',
        studentId: studentB.id,
        student: { id: studentB.id, name: studentB.name },
        concept: 'states of matter and processes',
        explanation: '…',
        status: 'PENDING',
        classWide: true,
        quizId: null,
        interactionId: null,
        createdAt: new Date('2026-08-01T10:01:00Z'),
      },
      {
        id: 'sig-3',
        studentId: studentC.id,
        student: { id: studentC.id, name: studentC.name },
        concept: 'gas vs plasma',
        explanation: '…',
        status: 'PENDING',
        classWide: false,
        quizId: null,
        interactionId: null,
        createdAt: new Date('2026-08-01T10:02:00Z'),
      },
      {
        id: 'sig-4',
        studentId: studentA.id,
        student: { id: studentA.id, name: studentA.name },
        concept: 'states of matter',
        explanation: '…',
        status: 'SENT',
        classWide: false,
        quizId: 'quiz-1',
        interactionId: 'int-1',
        createdAt: new Date('2026-08-01T10:03:00Z'),
      },
    ];
    mockPrisma.struggleSignal.findMany.mockResolvedValue(signals);

    const result = await service.getSignalsForMeeting(teacher, MEETING_ID);
    expect(result.pending.classWide).toHaveLength(1);
    expect(result.pending.classWide[0].concept).toBe('states of matter');
    expect(result.pending.classWide[0].studentCount).toBe(2);
    expect(result.pending.individual.map((s) => s.id)).toEqual(['sig-3']);
    expect(result.history.map((s) => s.id)).toEqual(['sig-4']);
  });

  it('sendSignal reuses the quiz engine + homework helper and marks SENT', async () => {
    mockPrisma.struggleSignal.findFirst.mockResolvedValue({
      id: 'sig-1',
      studentId: studentA.id,
      concept: 'states of matter',
      status: 'PENDING',
      meeting: {
        courseOfferingId: OFFERING_A,
        courseOffering: { teacherId: teacher.id },
      },
    });
    mockQuizzes.generateForConcept.mockResolvedValue({
      quizId: 'quiz-1',
      title: 'States of matter',
      message: 'done',
    });
    mockHomework.help.mockResolvedValue({
      action: 'ANSWER',
      interactionId: 'int-1',
      text: 'Here you go…',
    });
    mockPrisma.courseOffering.findUnique.mockResolvedValue({
      id: OFFERING_A,
      courseId: 'course-1',
    });
    mockPrisma.quiz.update.mockResolvedValue({});
    mockPrisma.struggleSignal.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.sendSignal(teacher, 'sig-1');

    // Both EXISTING pipelines were used: the quiz engine resolves a unit from
    // the concept (never generates from the concept text), and the homework
    // helper re-explains the concept.
    expect(mockQuizzes.generateForConcept).toHaveBeenCalledWith({
      courseId: 'course-1',
      courseOfferingId: OFFERING_A,
      studentId: studentA.id,
      concept: 'states of matter',
      teacherId: teacher.id,
    });
    expect(mockHomework.help).toHaveBeenCalledWith({
      courseOfferingId: OFFERING_A,
      studentId: studentA.id,
      question:
        'Please re-explain this concept that came up in our class: states of matter.',
    });
    // The generated quiz is already scoped via its assignment; just publish.
    expect(mockPrisma.quiz.update).toHaveBeenCalledWith({
      where: { id: 'quiz-1' },
      data: { status: 'PUBLISHED' },
    });
    expect(mockPrisma.struggleSignal.updateMany).toHaveBeenCalledWith({
      where: { id: 'sig-1', status: { in: ['PENDING', 'FAILED'] } },
      data: { status: 'SENT', quizId: 'quiz-1', interactionId: 'int-1' },
    });
    expect(mockNotifications.notifyUser).toHaveBeenCalledWith(
      studentA.id,
      'QUIZ_READY',
      expect.stringContaining('practice quiz'),
      expect.stringContaining('states of matter'),
      { quizId: 'quiz-1', concept: 'states of matter' },
    );
    expect(result).toEqual({ id: 'sig-1', status: 'SENT', quizId: 'quiz-1' });
  });

  it('does not send an already-processed signal twice', async () => {
    mockPrisma.struggleSignal.findFirst.mockResolvedValue({
      id: 'sig-1',
      studentId: studentA.id,
      concept: 'states of matter',
      status: 'SENT',
      meeting: {
        courseOfferingId: OFFERING_A,
        courseOffering: { teacherId: teacher.id },
      },
    });
    mockQuizzes.generate.mockResolvedValue({
      quizId: 'quiz-1',
      title: 'x',
      message: 'x',
    });
    mockHomework.help.mockResolvedValue({
      action: 'ANSWER',
      interactionId: 'int-1',
      text: 'x',
    });

    await expect(service.sendSignal(teacher, 'sig-1')).rejects.toMatchObject({
      code: ErrorCode.STRUGGLE_SIGNAL_NOT_ACTIONABLE,
    });
    // The status guard short-circuits before any expensive generation.
    expect(mockQuizzes.generate).not.toHaveBeenCalled();
    expect(mockHomework.help).not.toHaveBeenCalled();
    expect(mockPrisma.quiz.update).not.toHaveBeenCalled();
  });

  it('leaves the signal PENDING when the homework re-explanation is ungrounded', async () => {
    mockPrisma.struggleSignal.findFirst.mockResolvedValue({
      id: 'sig-1',
      studentId: studentA.id,
      concept: 'states of matter',
      status: 'PENDING',
      meeting: {
        courseOfferingId: OFFERING_A,
        courseOffering: { teacherId: teacher.id },
      },
    });
    mockQuizzes.generate.mockResolvedValue({
      quizId: 'quiz-1',
      title: 'x',
      message: 'x',
    });
    mockHomework.help.mockResolvedValue({ action: 'REDIRECT_TEACHER' });

    await expect(service.sendSignal(teacher, 'sig-1')).rejects.toMatchObject({
      code: ErrorCode.STRUGGLE_GENERATION_FAILED,
    });
    expect(mockPrisma.struggleSignal.updateMany).not.toHaveBeenCalled();
  });

  it('dismisses with an explicit teacher action only', async () => {
    mockPrisma.struggleSignal.findFirst.mockResolvedValue({
      id: 'sig-1',
      studentId: studentA.id,
      concept: 'states of matter',
      status: 'PENDING',
      meeting: {
        courseOfferingId: OFFERING_A,
        courseOffering: { teacherId: teacher.id },
      },
    });
    mockPrisma.struggleSignal.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.dismissSignal(teacher, 'sig-1');
    expect(result).toEqual({ id: 'sig-1', status: 'DISMISSED' });
    expect(mockPrisma.struggleSignal.updateMany).toHaveBeenCalledWith({
      where: { id: 'sig-1', status: 'PENDING' },
      data: { status: 'DISMISSED' },
    });
  });

  it('rejects signals from meetings the teacher does not teach', async () => {
    mockPrisma.struggleSignal.findFirst.mockResolvedValue({
      id: 'sig-1',
      studentId: studentA.id,
      concept: 'x',
      status: 'PENDING',
      meeting: {
        courseOfferingId: OFFERING_B,
        courseOffering: { teacherId: otherTeacher.id },
      },
    });
    await expect(service.sendSignal(teacher, 'sig-1')).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.dismissSignal(teacher, 'sig-1')).rejects.toThrow(
      ForbiddenException,
    );
  });
});
