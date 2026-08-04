import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InsightsService } from './insights.service';

const DAY = 24 * 60 * 60 * 1000;
const current = (daysAgo = 1) => new Date(Date.now() - daysAgo * DAY);
const previous = () => new Date(Date.now() - 105 * DAY);

describe('InsightsService', () => {
  let service: InsightsService;

  const fixtures = {
    submissions: [] as { createdAt: Date }[],
    gradingScores: {
      pending: [] as { createdAt: Date }[],
      confirmedTrend: [] as { createdAt: Date }[],
      confirmedAll: [] as unknown[],
    },
    alerts: {
      created: [] as { createdAt: Date }[],
      resolved: [] as { updatedAt: Date }[],
      active: [] as { type: string; reason: string }[],
      all: [] as { status: string }[],
    },
    attendance: [] as { date: Date; status: string }[],
    interactions: [] as unknown[],
    analyses: [] as unknown[],
    reports: [] as unknown[],
    usersGrowth: [] as { createdAt: Date }[],
    teachers: [] as unknown[],
    guardian: null as unknown,
    targetStudent: null as unknown,
    teacherClass: null as unknown,
    guardianMatch: null as unknown,
  };

  interface CallArgs {
    where?: Record<string, unknown>;
    include?: Record<string, unknown>;
  }

  const argsOf = (fn: jest.Mock, index = 0): CallArgs => {
    const call = fn.mock.calls as unknown[];
    return call[index]?.[0] as CallArgs;
  };

  const mockPrisma = {
    notification: { count: jest.fn() },
    submission: { findMany: jest.fn() },
    gradingScore: { findMany: jest.fn() },
    alert: { findMany: jest.fn() },
    attendance: { findMany: jest.fn() },
    homeworkHelpInteraction: { findMany: jest.fn() },
    studentAnalysis: { findMany: jest.fn() },
    studentReport: { findMany: jest.fn() },
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    class: { findFirst: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockPrisma.notification.count.mockResolvedValue(3);
    mockPrisma.submission.findMany.mockImplementation(() =>
      Promise.resolve(fixtures.submissions),
    );
    mockPrisma.gradingScore.findMany.mockImplementation(
      (args: {
        where?: {
          isConfirmed?: boolean;
          createdAt?: unknown;
          submission?: { studentId?: string };
        };
      }) => {
        if (args.where?.isConfirmed === false) {
          return Promise.resolve(fixtures.gradingScores.pending);
        }
        if (args.where?.submission?.studentId) {
          return Promise.resolve(fixtures.gradingScores.confirmedAll);
        }
        if (args.where?.createdAt) {
          return Promise.resolve(fixtures.gradingScores.confirmedTrend);
        }
        return Promise.resolve(fixtures.gradingScores.confirmedAll);
      },
    );
    mockPrisma.alert.findMany.mockImplementation(
      (args: {
        where?: {
          updatedAt?: unknown;
          status?: unknown;
          createdAt?: unknown;
        };
      }) => {
        if (args.where?.updatedAt)
          return Promise.resolve(fixtures.alerts.resolved);
        if (args.where?.status === 'ACTIVE')
          return Promise.resolve(fixtures.alerts.active);
        if (args.where?.createdAt)
          return Promise.resolve(fixtures.alerts.created);
        return Promise.resolve(fixtures.alerts.all);
      },
    );
    mockPrisma.attendance.findMany.mockImplementation(() =>
      Promise.resolve(fixtures.attendance),
    );
    mockPrisma.homeworkHelpInteraction.findMany.mockImplementation(() =>
      Promise.resolve(fixtures.interactions),
    );
    mockPrisma.studentAnalysis.findMany.mockImplementation(() =>
      Promise.resolve(fixtures.analyses),
    );
    mockPrisma.studentReport.findMany.mockImplementation(() =>
      Promise.resolve(fixtures.reports),
    );
    mockPrisma.user.findMany.mockImplementation(
      (args: { where?: { role?: string | { in: string[] } } }) => {
        if (args.where?.role === 'TEACHER') {
          return Promise.resolve(fixtures.teachers);
        }
        return Promise.resolve(fixtures.usersGrowth);
      },
    );
    mockPrisma.user.findUnique.mockImplementation(
      (args: { include?: { wards?: unknown } }) => {
        if (args.include?.wards) return Promise.resolve(fixtures.guardian);
        return Promise.resolve(fixtures.targetStudent);
      },
    );
    mockPrisma.user.findFirst.mockImplementation(() =>
      Promise.resolve(fixtures.guardianMatch),
    );
    mockPrisma.class.findFirst.mockImplementation(() =>
      Promise.resolve(fixtures.teacherClass),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InsightsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<InsightsService>(InsightsService);
  });

  const teacherUser = { id: 't1', role: 'TEACHER' } as User;
  const studentUser = { id: 's1', role: 'STUDENT' } as User;
  const guardianUser = { id: 'g1', role: 'GUARDIAN' } as User;
  const adminUser = { id: 'a1', role: 'ADMIN' } as User;

  describe('TEACHER', () => {
    beforeEach(() => {
      fixtures.submissions = [
        { createdAt: current() },
        { createdAt: current() },
      ];
      fixtures.gradingScores.pending = [{ createdAt: current() }];
      fixtures.gradingScores.confirmedTrend = [
        { createdAt: current() },
        { createdAt: current() },
        { createdAt: current() },
      ];
      fixtures.gradingScores.confirmedAll = [
        {
          pointsAwarded: 8,
          criteria: { maxPoints: 10, description: 'Clarity' },
          submission: { assignment: { class: { name: 'Math' } } },
        },
        {
          pointsAwarded: 4,
          criteria: { maxPoints: 10, description: 'Clarity' },
          submission: { assignment: { class: { name: 'Math' } } },
        },
      ];
      fixtures.alerts.created = [
        { createdAt: current() },
        { createdAt: current() },
      ];
      fixtures.alerts.resolved = [{ updatedAt: current() }];
      fixtures.attendance = [];
      fixtures.interactions = [
        {
          student: { id: 's1', name: 'S1' },
          question: 'How do I solve x?',
          createdAt: current(),
        },
      ];
      fixtures.analyses = [
        {
          student: { id: 's1', name: 'S1' },
          teacherContent: { skillGaps: ['Algebra'] },
          createdAt: current(),
        },
      ];
      fixtures.reports = [
        {
          student: { id: 's1', name: 'S1' },
          teacherSection: 'Needs practice',
          createdAt: current(),
        },
      ];
    });

    it('builds all teacher sections scoped to own classes', async () => {
      const result = await service.getInsights(teacherUser, 'week');

      expect(result.interval).toBe('week');
      expect(result.unreadNotifications).toBe(3);
      expect(result.sections.map((s) => s.key)).toEqual([
        'submissions_volume',
        'confirmed_grades',
        'pending_confirmations',
        'alerts_created',
        'alerts_resolved',
        'attendance_rate',
        'class_average',
        'criterion_average',
        'struggling_students',
      ]);

      const submissions = result.sections.find(
        (s) => s.key === 'submissions_volume',
      );
      expect(submissions?.series.reduce((a, b) => a + b.value, 0)).toBe(2);
      expect(submissions?.delta).toEqual({
        deltaPercent: 100,
        direction: 'up',
      });
    });

    it('never counts unconfirmed grades in confirmed sections', async () => {
      const result = await service.getInsights(teacherUser, 'week');

      const confirmed = result.sections.find(
        (s) => s.key === 'confirmed_grades',
      );
      const pending = result.sections.find(
        (s) => s.key === 'pending_confirmations',
      );

      expect(confirmed?.series.reduce((a, b) => a + b.value, 0)).toBe(3);
      expect(pending?.series.reduce((a, b) => a + b.value, 0)).toBe(1);
      expect(
        mockPrisma.gradingScore.findMany.mock.calls.some(
          ([args]) => (args as CallArgs).where?.isConfirmed === true,
        ),
      ).toBe(true);
    });

    it('compares deltas against the previous window', async () => {
      fixtures.gradingScores.pending = [
        { createdAt: current() },
        { createdAt: current() },
        { createdAt: previous() },
      ];
      const result = await service.getInsights(teacherUser, 'week');

      const pending = result.sections.find(
        (s) => s.key === 'pending_confirmations',
      );
      expect(pending?.series.reduce((a, b) => a + b.value, 0)).toBe(2);
      expect(pending?.delta).toEqual({ deltaPercent: 100, direction: 'up' });
    });

    it('computes per-class and per-criterion averages from confirmed scores only', async () => {
      const result = await service.getInsights(teacherUser, 'week');

      const classAvg = result.sections.find((s) => s.key === 'class_average');
      const criterionAvg = result.sections.find(
        (s) => s.key === 'criterion_average',
      );

      expect(classAvg?.series).toEqual([{ label: 'Math', value: 60 }]);
      expect(criterionAvg?.series).toEqual([{ label: 'Clarity', value: 60 }]);
    });

    it('surfaces own-class agent insights', async () => {
      const result = await service.getInsights(teacherUser, 'week');

      expect(result.agentInsights).toEqual(
        expect.arrayContaining([
          { title: 'S1 — flagged', summary: 'Skill gaps: Algebra' },
          { title: 'S1 — report', summary: 'Needs practice' },
          { title: 'S1 asked for help', summary: 'How do I solve x?' },
        ]),
      );
    });
  });

  describe('STUDENT', () => {
    beforeEach(() => {
      fixtures.gradingScores.confirmedAll = [];
      fixtures.attendance = [];
      fixtures.interactions = [
        { action: 'HINT' },
        { action: 'EXPLANATION' },
        { action: 'REDIRECT_TEACHER' },
        { action: 'REDIRECT_TEACHER' },
      ];
      fixtures.alerts.active = [{ type: 'FAILING', reason: 'Low score' }];
      fixtures.reports = [{ teacherSection: 'Report text' }];
    });

    it('builds student sections self-scoped', async () => {
      const result = await service.getInsights(studentUser, 'week');

      expect(result.sections.map((s) => s.key)).toEqual([
        'grade_trend',
        'attendance_trend',
        'criterion_strengths',
        'help_action_split',
      ]);
      expect(
        (
          argsOf(mockPrisma.gradingScore.findMany).where?.submission as {
            studentId: string;
          }
        ).studentId,
      ).toBe('s1');
    });

    it('splits homework-helper outcomes in the donut', async () => {
      const result = await service.getInsights(studentUser, 'week');

      const donut = result.sections.find((s) => s.key === 'help_action_split');
      expect(donut?.series).toEqual([
        { label: 'HINT', value: 1 },
        { label: 'EXPLANATION', value: 1 },
        { label: 'REDIRECT_TEACHER', value: 2 },
      ]);
    });

    it('adds active alerts and the latest report as agent insights', async () => {
      const result = await service.getInsights(studentUser, 'week');

      expect(result.agentInsights).toEqual([
        { title: 'Alert: FAILING', summary: 'Low score' },
        { title: 'Latest report', summary: 'Report text' },
      ]);
    });
  });

  describe('GUARDIAN', () => {
    beforeEach(() => {
      fixtures.guardian = {
        id: 'g1',
        wards: [{ id: 'w1', name: 'Ward One' }],
      };
      fixtures.gradingScores.confirmedAll = [
        {
          pointsAwarded: 8,
          criteria: { maxPoints: 10, description: 'Clarity' },
          submission: { createdAt: current() },
        },
      ];
      fixtures.attendance = [];
      fixtures.alerts.created = [{ createdAt: current() }];
      fixtures.reports = [{ parentSection: 'Great progress' }];
      fixtures.analyses = [{ guardianContent: 'Keep going' }];
    });

    it('builds per-child sections for own wards only', async () => {
      const result = await service.getInsights(guardianUser, 'week');

      expect(result.sections.map((s) => s.key)).toEqual([
        'child_w1_grades',
        'child_w1_attendance',
        'child_w1_alerts',
      ]);
      expect(argsOf(mockPrisma.user.findUnique).include?.wards).toBeDefined();
    });

    it('adds parent-facing agent insights per child', async () => {
      const result = await service.getInsights(guardianUser, 'week');

      expect(result.agentInsights).toEqual([
        { title: 'Ward One — report', summary: 'Great progress' },
        { title: 'Ward One — analysis', summary: 'Keep going' },
      ]);
    });

    it('returns empty sections for a guardian with no wards', async () => {
      fixtures.guardian = { id: 'g1', wards: [] };
      const result = await service.getInsights(guardianUser, 'week');

      expect(result.sections).toEqual([]);
      expect(result.agentInsights).toEqual([]);
    });
  });

  describe('ADMIN', () => {
    beforeEach(() => {
      fixtures.submissions = [
        { createdAt: current() },
        { createdAt: current() },
      ];
      fixtures.gradingScores.confirmedTrend = [
        { createdAt: current() },
        { createdAt: current() },
      ];
      fixtures.gradingScores.confirmedAll = [
        { pointsAwarded: 7, criteria: { maxPoints: 10 }, createdAt: current() },
        { pointsAwarded: 5, criteria: { maxPoints: 10 }, createdAt: current() },
        { pointsAwarded: 9, criteria: { maxPoints: 10 }, createdAt: current() },
      ];
      fixtures.alerts.created = [{ createdAt: current() }];
      fixtures.alerts.all = [{ status: 'ACTIVE' }, { status: 'RESOLVED' }];
      fixtures.usersGrowth = [
        { createdAt: current() },
        { createdAt: current() },
      ];
      fixtures.teachers = [
        {
          id: 't1',
          name: 'T1',
          taughtClasses: [
            {
              enrollments: [{ id: 'e1' }, { id: 'e2' }],
              assignments: [
                {
                  submissions: [
                    {
                      scores: [
                        { isConfirmed: false },
                        {
                          isConfirmed: true,
                          pointsAwarded: 8,
                          criteria: { maxPoints: 10 },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ];
      fixtures.reports = [
        { student: { name: 'S1' }, managementSection: 'Focus areas' },
      ];
    });

    it('builds school-wide sections', async () => {
      const result = await service.getInsights(adminUser, 'week');

      expect(result.sections.map((s) => s.key)).toEqual([
        'submissions_volume',
        'confirmed_grades',
        'pass_rate_trend',
        'alerts_created',
        'user_growth',
        'teacher_workload',
        'alert_status_split',
      ]);

      const submissions = result.sections.find(
        (s) => s.key === 'submissions_volume',
      );
      expect(submissions?.series.reduce((a, b) => a + b.value, 0)).toBe(2);
    });

    it('computes the pass rate per bucket from confirmed rows only', async () => {
      const result = await service.getInsights(adminUser, 'week');

      const passRate = result.sections.find((s) => s.key === 'pass_rate_trend');
      const nonzero = passRate?.series.filter((p) => p.value > 0);
      expect(nonzero).toHaveLength(1);
      expect(nonzero?.[0].value).toBe(66.7);
    });

    it('excludes unconfirmed scores from teacher workload and averages', async () => {
      const result = await service.getInsights(adminUser, 'week');

      const workload = result.sections.find(
        (s) => s.key === 'teacher_workload',
      );
      expect(workload?.series).toEqual([{ label: 'T1', value: 3 }]);

      const teacherSummary = result.agentInsights.find((i) =>
        i.title.startsWith('T1'),
      );
      expect(teacherSummary?.summary).toBe(
        'Average 80% · 1 pending reviews · 2 students',
      );
    });

    it('splits alert statuses in the donut', async () => {
      const result = await service.getInsights(adminUser, 'week');

      const donut = result.sections.find((s) => s.key === 'alert_status_split');
      expect(donut?.series).toEqual([
        { label: 'ACTIVE', value: 1 },
        { label: 'RESOLVED', value: 1 },
      ]);
    });
  });

  describe('drill-down — GET /dashboard/insights/students/:id', () => {
    beforeEach(() => {
      fixtures.targetStudent = { id: 's1', name: 'S1', role: 'STUDENT' };
      fixtures.gradingScores.confirmedAll = [];
      fixtures.attendance = [];
      fixtures.interactions = [];
      fixtures.alerts.active = [];
      fixtures.reports = [];
    });

    it('allows a teacher whose class the student is approved in', async () => {
      fixtures.teacherClass = { id: 'c1' };
      const result = await service.getStudentInsights(
        teacherUser,
        's1',
        'week',
      );

      expect(result.sections.some((s) => s.key === 'grade_trend')).toBe(true);
      expect(
        (argsOf(mockPrisma.class.findFirst).where as { teacherId: string })
          .teacherId,
      ).toBe('t1');
    });

    it('forbids a teacher who does not teach the student', async () => {
      fixtures.teacherClass = null;
      await expect(
        service.getStudentInsights(teacherUser, 's1', 'week'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('forbids a student viewing someone else', async () => {
      await expect(
        service.getStudentInsights(studentUser, 's2', 'week'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows a student viewing themselves', async () => {
      const result = await service.getStudentInsights(
        studentUser,
        's1',
        'week',
      );
      expect(result.sections.some((s) => s.key === 'grade_trend')).toBe(true);
    });

    it('forbids a guardian who is not the ward guardian', async () => {
      fixtures.guardianMatch = null;
      await expect(
        service.getStudentInsights(guardianUser, 's1', 'week'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows admins', async () => {
      const result = await service.getStudentInsights(adminUser, 's1', 'week');
      expect(result.sections.some((s) => s.key === 'grade_trend')).toBe(true);
    });

    it('returns 404 for a missing student', async () => {
      fixtures.targetStudent = null;
      await expect(
        service.getStudentInsights(adminUser, 'missing', 'week'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
