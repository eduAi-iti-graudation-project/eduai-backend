import { Test, TestingModule } from '@nestjs/testing';
import { CommunicationAgentService } from './communication-agent.service';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';
import { ReportsService } from '../reports/reports.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('CommunicationAgentService (enterprise gate)', () => {
  let service: CommunicationAgentService;

  const mockPrisma = {
    submission: {
      findUnique: jest.fn(),
    },
    organization: {
      findUnique: jest.fn(),
    },
    gradingScore: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    attendance: {
      findMany: jest.fn(),
    },
    alert: {
      findMany: jest.fn(),
    },
    class: {
      findUnique: jest.fn(),
    },
    studentAnalysis: {
      create: jest.fn(),
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

  beforeEach(async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'student-1',
      name: 'Sam Learner',
    });
    mockPrisma.gradingScore.findMany.mockResolvedValue([]);
    mockPrisma.attendance.findMany.mockResolvedValue([]);
    mockPrisma.alert.findMany.mockResolvedValue([]);
    mockPrisma.class.findUnique.mockResolvedValue({
      id: 'class-1',
      name: 'Math 101',
      teacherId: 'teacher-1',
    });
    mockPrisma.studentAnalysis.create.mockResolvedValue({ id: 'sa-1' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommunicationAgentService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LlmService, useValue: mockLlm },
        { provide: ReportsService, useValue: mockReports },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();

    service = module.get<CommunicationAgentService>(CommunicationAgentService);
    jest.clearAllMocks();
  });

  function submissionWith(orgId: string) {
    return {
      id: 'sub-1',
      studentId: 'student-1',
      assignment: { classId: 'class-1', class: { organizationId: orgId } },
      student: { id: 'student-1' },
    };
  }

  it('returns early when the submission does not exist', async () => {
    mockPrisma.submission.findUnique.mockResolvedValue(null);

    await service.analyze('missing');

    expect(mockPrisma.organization.findUnique).not.toHaveBeenCalled();
    expect(mockLlm.generateStructured).not.toHaveBeenCalled();
  });

  it('skips the agent for ACTIVE orgs below Enterprise', async () => {
    mockPrisma.submission.findUnique.mockResolvedValue(submissionWith('org-1'));
    mockPrisma.organization.findUnique.mockResolvedValue({
      subscriptionStatus: 'ACTIVE',
      subscriptionTier: 'PRO',
    });

    await service.analyze('sub-1');

    expect(mockPrisma.organization.findUnique).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      select: { subscriptionStatus: true, subscriptionTier: true },
    });
    expect(mockPrisma.gradingScore.count).not.toHaveBeenCalled();
    expect(mockLlm.generateStructured).not.toHaveBeenCalled();
  });

  it('runs the agent for Enterprise orgs', async () => {
    mockPrisma.submission.findUnique.mockResolvedValue(submissionWith('org-1'));
    mockPrisma.organization.findUnique.mockResolvedValue({
      subscriptionStatus: 'ACTIVE',
      subscriptionTier: 'ENTERPRISE',
    });
    mockPrisma.gradingScore.count.mockResolvedValue(3);
    mockLlm.generateStructured.mockResolvedValue({
      hasIssue: false,
      issueType: null,
      severity: null,
      summary: null,
      classContext: null,
    });

    await service.analyze('sub-1');

    expect(mockLlm.generateStructured).toHaveBeenCalledTimes(1);
  });

  it('runs the agent during the trial (full access policy)', async () => {
    mockPrisma.submission.findUnique.mockResolvedValue(submissionWith('org-1'));
    mockPrisma.organization.findUnique.mockResolvedValue({
      subscriptionStatus: 'TRIALING',
      subscriptionTier: 'TRIAL',
    });
    mockPrisma.gradingScore.count.mockResolvedValue(3);
    mockLlm.generateStructured.mockResolvedValue({
      hasIssue: false,
      issueType: null,
      severity: null,
      summary: null,
      classContext: null,
    });

    await service.analyze('sub-1');

    expect(mockLlm.generateStructured).toHaveBeenCalledTimes(1);
  });

  it('still skips the LLM when the org is Enterprise but scores are insufficient', async () => {
    mockPrisma.submission.findUnique.mockResolvedValue(submissionWith('org-1'));
    mockPrisma.organization.findUnique.mockResolvedValue({
      subscriptionStatus: 'ACTIVE',
      subscriptionTier: 'ENTERPRISE',
    });
    mockPrisma.gradingScore.count.mockResolvedValue(1);

    await service.analyze('sub-1');

    expect(mockLlm.generateStructured).not.toHaveBeenCalled();
  });
});
