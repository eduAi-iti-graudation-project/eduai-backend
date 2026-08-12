import { Test, TestingModule } from '@nestjs/testing';
import { CommunicationAgentService } from './communication-agent.service';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';
import { ReportsService } from '../reports/reports.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StudyLabService } from '../study-lab/study-lab.service';

describe('CommunicationAgentService', () => {
  let service: CommunicationAgentService;

  const mockPrisma = {
    submission: {
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    organization: {
      findUnique: jest.fn(),
    },
    gradingScore: {
      findMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    attendance: {
      findMany: jest.fn(),
    },
    alert: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
    courseOffering: {
      findUnique: jest.fn(),
    },
    studentAnalysis: {
      create: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };

  const mockLlm = {
    generateStructured: jest.fn(),
  };

  const mockReports = {
    generate: jest.fn(),
  };

  const mockNotifications = {
    notifyUser: jest.fn(),
  };

  const mockStudyLab = {
    recommend: jest.fn(),
  };

  // [submissionId, pct, dayOffset]
  const decliningGrades = [
    ['sub-1', 70, 0],
    ['sub-2', 58, 1],
    ['sub-3', 45, 2],
  ] as const;

  interface FindManyArgs {
    include?: {
      submission?: { select?: { studentId?: boolean } };
      criteria?: { select?: { maxPoints?: boolean } };
    };
  }

  type ProfileRow = readonly [
    string,
    number,
    number,
    criteriaId?: string,
    criteriaDescription?: string,
  ];

  function profileGrades(rows: readonly ProfileRow[]) {
    return rows.map(
      ([
        submissionId,
        pct,
        dayOffset,
        criteriaId = 'crit-argument',
        criteriaDescription = 'Argument',
      ]) => ({
        submissionId,
        pointsAwarded: pct,
        criteria: {
          id: criteriaId,
          maxPoints: 100,
          description: criteriaDescription,
        },
        submission: {
          id: submissionId,
          createdAt: new Date(Date.UTC(2026, 0, 1 + dayOffset)),
        },
      }),
    );
  }

  function classScoreRows(
    students: { id: string; pct: number; dayOffset: number }[],
  ) {
    return students.map((s, i) => ({
      pointsAwarded: s.pct,
      criteria: { maxPoints: 100 },
      submission: {
        id: `cs-${i}`,
        studentId: s.id,
        createdAt: new Date(Date.UTC(2026, 0, 1 + s.dayOffset)),
      },
    }));
  }

  beforeEach(async () => {
    mockPrisma.submission.findUnique.mockResolvedValue({
      id: 'sub-1',
      studentId: 'student-1',
      assignment: {
        offering: { organizationId: 'org-1', id: 'offering-1' },
      },
      student: { id: 'student-1' },
    });
    mockPrisma.submission.count.mockResolvedValue(3);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'student-1',
      name: 'Sam Learner',
      guardianId: 'guardian-1',
    });
    mockPrisma.attendance.findMany.mockResolvedValue([]);
    mockPrisma.alert.findMany.mockResolvedValue([]);
    mockPrisma.alert.create.mockResolvedValue({ id: 'alert-1' });
    mockPrisma.courseOffering.findUnique.mockResolvedValue({
      id: 'offering-1',
      teacherId: 'teacher-1',
    });
    mockPrisma.studentAnalysis.create.mockResolvedValue({ id: 'sa-1' });
    mockReports.generate.mockResolvedValue({ id: 'report-1' });

    mockPrisma.gradingScore.findMany.mockImplementation((args: FindManyArgs) =>
      args?.include?.submission?.select?.studentId
        ? Promise.resolve(
            classScoreRows([
              { id: 'student-1', pct: 50, dayOffset: 0 },
              { id: 'student-2', pct: 80, dayOffset: 0 },
              { id: 'student-3', pct: 90, dayOffset: 0 },
            ]),
          )
        : Promise.resolve(profileGrades(decliningGrades)),
    );

    mockLlm.generateStructured.mockResolvedValue({
      reason: 'The numbers show a clear decline across recent submissions.',
      analysis: 'needs support on fundamentals',
      skillGaps: ['fractions'],
      interventions: ['extra practice'],
      resourceSuggestions: ['Khan Academy'],
      message: 'Your child needs some support.',
      homeSupport: ['set a study routine'],
      feedback: 'Try breaking content into smaller steps.',
      patternAnalysis: 'The class trend is flat.',
      strategies: ['mix retrieval practice'],
      summary: 'The class is performing below expectations.',
      classTrend: 'holding steady',
      recommendation: 'Monitor the next batch of assignments.',
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommunicationAgentService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LlmService, useValue: mockLlm },
        { provide: ReportsService, useValue: mockReports },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: StudyLabService, useValue: mockStudyLab },
      ],
    }).compile();

    service = module.get<CommunicationAgentService>(CommunicationAgentService);
    jest.clearAllMocks();
  });

  it('returns early when the submission does not exist', async () => {
    mockPrisma.submission.findUnique.mockResolvedValue(null);

    await service.analyze('missing');

    expect(mockPrisma.organization.findUnique).not.toHaveBeenCalled();
    expect(mockLlm.generateStructured).not.toHaveBeenCalled();
  });

  it('skips the agent for ACTIVE orgs below Trial/Enterprise', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({
      subscriptionStatus: 'ACTIVE',
      subscriptionTier: 'PRO',
    });

    await service.analyze('sub-1');

    expect(mockPrisma.submission.count).not.toHaveBeenCalled();
    expect(mockLlm.generateStructured).not.toHaveBeenCalled();
  });

  it('runs the agent during trial (full access policy)', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({
      subscriptionStatus: 'TRIALING',
      subscriptionTier: 'TRIAL',
    });

    await service.analyze('sub-1');

    expect(mockPrisma.submission.count).toHaveBeenCalled();
    expect(mockPrisma.studentAnalysis.create).toHaveBeenCalled();
  });

  it('skips when fewer than two confirmed submissions exist', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({
      subscriptionStatus: 'TRIALING',
      subscriptionTier: 'TRIAL',
    });
    mockPrisma.submission.count.mockResolvedValue(1);

    await service.analyze('sub-1');

    expect(mockPrisma.studentAnalysis.create).not.toHaveBeenCalled();
    expect(mockLlm.generateStructured).not.toHaveBeenCalled();
  });

  it('records a no-issue analysis without any LLM calls when nothing trips', async () => {
    const healthy = [
      ['sub-1', 82, 0],
      ['sub-2', 85, 1],
      ['sub-3', 88, 2],
    ] as const;
    mockPrisma.organization.findUnique.mockResolvedValue({
      subscriptionStatus: 'TRIALING',
      subscriptionTier: 'TRIAL',
    });
    mockPrisma.gradingScore.findMany.mockImplementation((args: FindManyArgs) =>
      args?.include?.submission?.select?.studentId
        ? Promise.resolve(
            classScoreRows([
              { id: 'student-1', pct: 85, dayOffset: 1 },
              { id: 'student-2', pct: 40, dayOffset: 1 },
            ]),
          )
        : Promise.resolve(profileGrades(healthy)),
    );

    await service.analyze('sub-1');

    expect(mockLlm.generateStructured).not.toHaveBeenCalled();
    const analysisCalls = mockPrisma.studentAnalysis.create.mock
      .calls as unknown as { data: { diagnosis: { decision: string } } }[][];
    expect(analysisCalls[0][0].data.diagnosis.decision).toBe('none');
    expect(mockPrisma.alert.create).not.toHaveBeenCalled();
  });

  it('creates a FAILING alert and explains via LLM when the student is failing', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({
      subscriptionStatus: 'TRIALING',
      subscriptionTier: 'TRIAL',
    });
    mockPrisma.gradingScore.findMany.mockImplementation((args: FindManyArgs) =>
      args?.include?.submission?.select?.studentId
        ? Promise.resolve(
            classScoreRows([
              { id: 'student-1', pct: 50, dayOffset: 0 },
              { id: 'student-2', pct: 80, dayOffset: 0 },
              { id: 'student-3', pct: 90, dayOffset: 0 },
            ]),
          )
        : Promise.resolve(profileGrades(decliningGrades)),
    );

    await service.analyze('sub-1');

    const alertCalls = mockPrisma.alert.create.mock.calls as unknown as {
      data: { type: 'FAILING'; studentId: string };
    }[][];
    expect(alertCalls[0][0].data.type).toBe('FAILING');
    expect(alertCalls[0][0].data.studentId).toBe('student-1');
    // explanation + teacher-content + guardian-content
    expect(mockLlm.generateStructured).toHaveBeenCalledTimes(3);
    mockReports.generate.mockResolvedValue({ id: 'report-1' });
    expect(mockReports.generate).toHaveBeenCalledWith('student-1', 'alert-1');
  });

  it('notifies the teacher and guardian when an alert is created', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({
      subscriptionStatus: 'TRIALING',
      subscriptionTier: 'TRIAL',
    });

    await service.analyze('sub-1');

    expect(mockNotifications.notifyUser).toHaveBeenCalledWith(
      'teacher-1',
      'AGENT_ALERT',
      expect.stringContaining('Sam Learner'),
      expect.any(String),
    );
    expect(mockNotifications.notifyUser).toHaveBeenCalledWith(
      'guardian-1',
      'AGENT_ALERT',
      expect.stringContaining('Sam Learner'),
      expect.any(String),
    );
  });

  it('flags WEAK_CRITERION when the overall average is fine but one criterion consistently underperforms', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({
      subscriptionStatus: 'TRIALING',
      subscriptionTier: 'TRIAL',
    });
    mockPrisma.gradingScore.findMany.mockImplementation((args: FindManyArgs) =>
      args?.include?.submission?.select?.studentId
        ? Promise.resolve(
            classScoreRows([
              { id: 'student-1', pct: 50, dayOffset: 0 },
              { id: 'student-2', pct: 80, dayOffset: 0 },
              { id: 'student-3', pct: 90, dayOffset: 0 },
            ]),
          )
        : Promise.resolve(
            profileGrades([
              ['sub-1', 100, 0, 'crit-argument', 'Argument'],
              ['sub-1', 20, 0, 'crit-evidence', 'Using evidence'],
              ['sub-2', 100, 1, 'crit-argument', 'Argument'],
              ['sub-2', 25, 1, 'crit-evidence', 'Using evidence'],
            ]),
          ),
    );

    await service.analyze('sub-1');

    const alertCalls = mockPrisma.alert.create.mock.calls as unknown as {
      data: { type: 'WEAK_CRITERION'; studentId: string };
    }[][];
    expect(alertCalls[0][0].data.type).toBe('WEAK_CRITERION');
    expect(alertCalls[0][0].data.studentId).toBe('student-1');
    expect(mockLlm.generateStructured).toHaveBeenCalledTimes(3);

    const analysisCalls = mockPrisma.studentAnalysis.create.mock
      .calls as unknown as {
      data: {
        diagnosis: {
          type: string;
          severity: string;
          weakCriteria: { description: string; avgPct: number }[];
        };
      };
    }[][];
    const diagnosis = analysisCalls[0][0].data.diagnosis;
    expect(diagnosis.type).toBe('WEAK_CRITERION');
    expect(diagnosis.severity).toBe('MEDIUM');
    expect(diagnosis.weakCriteria[0]).toEqual({
      criteriaId: 'crit-evidence',
      description: 'Using evidence',
      avgPct: 23,
    });
  });

  it('passes criterion stats to the explanation LLM prompt', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({
      subscriptionStatus: 'TRIALING',
      subscriptionTier: 'TRIAL',
    });
    mockPrisma.gradingScore.findMany.mockImplementation((args: FindManyArgs) =>
      args?.include?.submission?.select?.studentId
        ? Promise.resolve(classScoreRows([]))
        : Promise.resolve(
            profileGrades([
              ['sub-1', 100, 0, 'crit-argument', 'Argument'],
              ['sub-1', 20, 0, 'crit-evidence', 'Using evidence'],
              ['sub-2', 100, 1, 'crit-argument', 'Argument'],
              ['sub-2', 25, 1, 'crit-evidence', 'Using evidence'],
            ]),
          ),
    );

    await service.analyze('sub-1');

    const calls = mockLlm.generateStructured.mock.calls as unknown as Array<
      Array<{ userPrompt: string }>
    >;
    const prompt = JSON.parse(calls[0][0].userPrompt) as {
      criterionStats: { criteriaId: string; count: number }[];
      weakCriteria: { description: string }[];
    };
    expect(prompt.criterionStats).toHaveLength(2);
    expect(prompt.weakCriteria[0].description).toBe('Using evidence');
  });

  it('downgrades a repeated weak criterion to CONSISTENT_STRUGGLE when an alert is already active', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({
      subscriptionStatus: 'TRIALING',
      subscriptionTier: 'TRIAL',
    });
    mockPrisma.alert.findMany.mockResolvedValue([
      {
        type: 'WEAK_CRITERION',
        reason: 'prior issue',
        status: 'ACTIVE',
        createdAt: new Date(),
      },
    ]);
    mockPrisma.gradingScore.findMany.mockImplementation((args: FindManyArgs) =>
      args?.include?.submission?.select?.studentId
        ? Promise.resolve(
            classScoreRows([
              { id: 'student-1', pct: 50, dayOffset: 0 },
              { id: 'student-2', pct: 80, dayOffset: 0 },
              { id: 'student-3', pct: 90, dayOffset: 0 },
            ]),
          )
        : Promise.resolve(
            profileGrades([
              ['sub-1', 100, 0, 'crit-argument', 'Argument'],
              ['sub-1', 20, 0, 'crit-evidence', 'Using evidence'],
              ['sub-2', 100, 1, 'crit-argument', 'Argument'],
              ['sub-2', 25, 1, 'crit-evidence', 'Using evidence'],
            ]),
          ),
    );

    await service.analyze('sub-1');

    const alertCalls = mockPrisma.alert.create.mock.calls as unknown as {
      data: { type: string };
    }[][];
    expect(alertCalls[0][0].data.type).toBe('CONSISTENT_STRUGGLE');
  });

  it('falls back to deterministic content and still alerts, notifies, and recommends practice when the LLM fails', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({
      subscriptionStatus: 'TRIALING',
      subscriptionTier: 'TRIAL',
    });
    mockLlm.generateStructured.mockRejectedValue(new Error('upstream 503'));
    mockStudyLab.recommend.mockResolvedValue('gen-1');

    await service.analyze('sub-1');

    expect(mockPrisma.alert.create).toHaveBeenCalled();
    expect(mockNotifications.notifyUser).toHaveBeenCalledWith(
      'guardian-1',
      'AGENT_ALERT',
      expect.stringContaining('Sam Learner'),
      expect.any(String),
    );
    expect(mockNotifications.notifyUser).toHaveBeenCalledWith(
      'student-1',
      'AGENT_ALERT',
      expect.stringContaining('recommended'),
      expect.any(String),
    );
    expect(mockStudyLab.recommend).toHaveBeenCalledWith(
      'student-1',
      expect.any(String),
      expect.any(String),
      'sa-1',
    );
    const analysisCalls = mockPrisma.studentAnalysis.create.mock
      .calls as unknown as { data: { guardianContent: object } }[][];
    expect(analysisCalls[0][0].data.guardianContent).toBeDefined();
  });
});
