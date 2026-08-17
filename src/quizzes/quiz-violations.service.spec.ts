import { Test, TestingModule } from '@nestjs/testing';
import { QuizViolationsService } from './quiz-violations.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ReportsService } from '../reports/reports.service';

const mockPrisma = {
  quizAttempt: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  alert: {
    create: jest.fn(),
  },
  user: {
    findMany: jest.fn(),
  },
};

const mockNotifications = {
  notifyUser: jest.fn(),
  notifyMany: jest.fn(),
};

const mockReports = {
  generate: jest.fn(),
};

const baseAttempt = {
  id: 'attempt-1',
  quizId: 'quiz-1',
  studentId: 'student-1',
  startedAt: new Date('2026-08-17T09:00:00.000Z'),
  status: 'IN_PROGRESS',
  violationReportedAt: null,
  violations: [{ type: 'TAB_SWITCH', occurredAt: '2026-08-17T09:01:00Z' }],
  quiz: { id: 'quiz-1', title: 'Math Quiz', timeLimit: 10 },
  student: {
    id: 'student-1',
    name: 'Ali',
    guardianId: 'guardian-1',
    organizationId: 'org-1',
  },
};

describe('QuizViolationsService', () => {
  let service: QuizViolationsService;

  beforeEach(async () => {
    jest.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuizViolationsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: ReportsService, useValue: mockReports },
      ],
    }).compile();

    service = module.get<QuizViolationsService>(QuizViolationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─── report() ─────────────────────────────────────────
  it('should create a QUIZ_VIOLATION alert, notify student/guardian/admins, and trigger the three-tier report', async () => {
    mockPrisma.quizAttempt.findUnique.mockResolvedValue(baseAttempt);
    mockPrisma.quizAttempt.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.alert.create.mockResolvedValue({ id: 'alert-1' });
    mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
    mockReports.generate.mockResolvedValue({ id: 'report-1' });

    const result = await service.report('attempt-1');

    expect(result).toBe(true);
    expect(mockPrisma.quizAttempt.updateMany).toHaveBeenCalledWith({
      where: { id: 'attempt-1', violationReportedAt: null },
      data: { violationReportedAt: expect.any(Date) as Date },
    });
    expect(mockPrisma.alert.create).toHaveBeenCalledWith({
      data: {
        type: 'QUIZ_VIOLATION',
        status: 'ACTIVE',
        studentId: 'student-1',
        reason: expect.stringContaining('Math Quiz') as string,
      },
    });
    expect(mockNotifications.notifyUser).toHaveBeenCalledWith(
      'student-1',
      'QUIZ_VIOLATION',
      expect.any(String),
      expect.stringContaining('Math Quiz'),
    );
    expect(mockNotifications.notifyUser).toHaveBeenCalledWith(
      'guardian-1',
      'QUIZ_VIOLATION',
      expect.stringContaining('Ali'),
      expect.any(String),
    );
    expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
      where: { role: 'ADMIN', organizationId: 'org-1' },
      select: { id: true },
    });
    expect(mockNotifications.notifyMany).toHaveBeenCalledWith(
      ['admin-1'],
      'QUIZ_VIOLATION',
      expect.any(String),
      expect.stringContaining('Ali'),
    );
    expect(mockReports.generate).toHaveBeenCalledWith('student-1', 'alert-1');
  });

  it('should skip the guardian when the student has none linked', async () => {
    mockPrisma.quizAttempt.findUnique.mockResolvedValue({
      ...baseAttempt,
      student: { ...baseAttempt.student, guardianId: null },
    });
    mockPrisma.quizAttempt.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.alert.create.mockResolvedValue({ id: 'alert-1' });
    mockPrisma.user.findMany.mockResolvedValue([]);

    await service.report('attempt-1');

    expect(mockNotifications.notifyUser).toHaveBeenCalledTimes(1);
    expect(mockNotifications.notifyUser).toHaveBeenCalledWith(
      'student-1',
      expect.any(String),
      expect.any(String),
      expect.any(String),
    );
    expect(mockNotifications.notifyMany).not.toHaveBeenCalled();
  });

  it('should be a no-op when the attempt was already reported', async () => {
    mockPrisma.quizAttempt.findUnique.mockResolvedValue({
      ...baseAttempt,
      violationReportedAt: new Date(),
    });

    const result = await service.report('attempt-1');

    expect(result).toBe(false);
    expect(mockPrisma.alert.create).not.toHaveBeenCalled();
    expect(mockNotifications.notifyUser).not.toHaveBeenCalled();
  });

  it('should be a no-op for attempts without violations', async () => {
    mockPrisma.quizAttempt.findUnique.mockResolvedValue({
      ...baseAttempt,
      violations: [],
    });

    const result = await service.report('attempt-1');

    expect(result).toBe(false);
    expect(mockPrisma.alert.create).not.toHaveBeenCalled();
  });

  it('should be a no-op when another call already claimed the attempt', async () => {
    mockPrisma.quizAttempt.findUnique.mockResolvedValue(baseAttempt);
    mockPrisma.quizAttempt.updateMany.mockResolvedValue({ count: 0 });

    const result = await service.report('attempt-1');

    expect(result).toBe(false);
    expect(mockPrisma.alert.create).not.toHaveBeenCalled();
  });

  it('should be a no-op for a missing attempt', async () => {
    mockPrisma.quizAttempt.findUnique.mockResolvedValue(null);

    const result = await service.report('missing');

    expect(result).toBe(false);
    expect(mockPrisma.alert.create).not.toHaveBeenCalled();
  });

  // ─── runSweep() ───────────────────────────────────────
  it('should close abandoned violating attempts and report them', async () => {
    const abandoned = {
      ...baseAttempt,
      id: 'attempt-old',
      startedAt: new Date(Date.now() - 30 * 60_000),
    };
    mockPrisma.quizAttempt.findMany.mockResolvedValue([abandoned]);
    mockPrisma.quizAttempt.update.mockResolvedValue(abandoned);

    mockPrisma.quizAttempt.findUnique.mockResolvedValue(abandoned);
    mockPrisma.quizAttempt.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.alert.create.mockResolvedValue({ id: 'alert-1' });
    mockPrisma.user.findMany.mockResolvedValue([]);

    const reported = await service.runSweep();

    expect(reported).toBe(1);
    expect(mockPrisma.quizAttempt.update).toHaveBeenCalledWith({
      where: { id: 'attempt-old' },
      data: { status: 'COMPLETED', submittedAt: expect.any(Date) as Date },
    });
    expect(mockPrisma.alert.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'QUIZ_VIOLATION',
        reason: expect.stringContaining('abandoned') as string,
      }) as { type: string; reason: string },
    });
  });

  it('should not close recent attempts that are still inside the window', async () => {
    mockPrisma.quizAttempt.findMany.mockResolvedValue([
      { ...baseAttempt, startedAt: new Date(Date.now() - 60_000) },
    ]);

    const reported = await service.runSweep();

    expect(reported).toBe(0);
    expect(mockPrisma.quizAttempt.update).not.toHaveBeenCalled();
    expect(mockPrisma.alert.create).not.toHaveBeenCalled();
  });

  it('should leave clean abandoned attempts alone', async () => {
    mockPrisma.quizAttempt.findMany.mockResolvedValue([
      {
        ...baseAttempt,
        violations: [],
        startedAt: new Date(Date.now() - 30 * 60_000),
      },
    ]);

    const reported = await service.runSweep();

    expect(reported).toBe(0);
    expect(mockPrisma.quizAttempt.update).not.toHaveBeenCalled();
    expect(mockPrisma.alert.create).not.toHaveBeenCalled();
  });

  it('should not touch abandoned attempts that were already reported', async () => {
    mockPrisma.quizAttempt.findMany.mockResolvedValue([
      {
        ...baseAttempt,
        violationReportedAt: new Date(),
        startedAt: new Date(Date.now() - 30 * 60_000),
      },
    ]);

    const reported = await service.runSweep();

    expect(reported).toBe(0);
    expect(mockPrisma.quizAttempt.update).not.toHaveBeenCalled();
  });
});
