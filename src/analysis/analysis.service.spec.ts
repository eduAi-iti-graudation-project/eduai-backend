import { Test, TestingModule } from '@nestjs/testing';
import { AnalysisService } from './analysis.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from '../reports/reports.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('AnalysisService', () => {
  let service: AnalysisService;

  const mockPrisma = {
    gradingScore: { findMany: jest.fn() },
    alert: { count: jest.fn(), create: jest.fn() },
    user: { findUnique: jest.fn() },
  };

  const mockReportsService = {
    generate: jest.fn().mockResolvedValue(undefined),
  };

  const mockNotificationsService = {
    notifyUser: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalysisService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ReportsService, useValue: mockReportsService },
        { provide: NotificationsService, useValue: mockNotificationsService },
      ],
    }).compile();

    service = module.get<AnalysisService>(AnalysisService);
    jest.clearAllMocks();
  });

  describe('evaluateStudent', () => {
    const studentId = 'student-uuid';

    it('should not create alert when no confirmed grades exist', async () => {
      mockPrisma.gradingScore.findMany.mockResolvedValue([]);

      await service.evaluateStudent(studentId);

      expect(mockPrisma.alert.create).not.toHaveBeenCalled();
    });

    it('should not create alert when fewer than 2 grades', async () => {
      mockPrisma.gradingScore.findMany.mockResolvedValue([
        { pointsAwarded: 8, submission: { id: 's1' } },
      ]);

      await service.evaluateStudent(studentId);

      expect(mockPrisma.alert.create).not.toHaveBeenCalled();
    });

    it('should not create alert when grades are above threshold', async () => {
      mockPrisma.gradingScore.findMany.mockResolvedValue([
        { pointsAwarded: 8, submission: { id: 's1' } },
        { pointsAwarded: 8, submission: { id: 's2' } },
        { pointsAwarded: 9, submission: { id: 's3' } },
      ]);

      await service.evaluateStudent(studentId);

      expect(mockPrisma.alert.create).not.toHaveBeenCalled();
    });

    it('should create FAILING alert when average is below 60%', async () => {
      const scores = [
        { pointsAwarded: 4, submission: { id: 's1' } },
        { pointsAwarded: 5, submission: { id: 's2' } },
        { pointsAwarded: 3, submission: { id: 's3' } },
      ];
      const createdAlert = {
        id: 'alert-1',
        type: 'FAILING',
        reason: 'Average...',
      };
      mockPrisma.gradingScore.findMany.mockResolvedValue(scores);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: studentId,
        name: 'Test Student',
        enrollments: [],
        guardianId: null,
      });
      mockPrisma.alert.create.mockResolvedValue(createdAlert);

      await service.evaluateStudent(studentId);

      expect(mockPrisma.alert.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          studentId,
          type: 'FAILING',
          status: 'ACTIVE',
        }) as object,
      });
      expect(mockReportsService.generate).toHaveBeenCalledWith(
        studentId,
        'alert-1',
      );
    });

    it('should create DOWNWARD_TREND alert when last 2 grades drop', async () => {
      const scores = [
        { pointsAwarded: 9, submission: { id: 's1' } },
        { pointsAwarded: 8, submission: { id: 's2' } },
        { pointsAwarded: 7, submission: { id: 's3' } },
      ];
      const createdAlert = {
        id: 'alert-2',
        type: 'DOWNWARD_TREND',
        reason: 'Average...',
      };
      mockPrisma.gradingScore.findMany.mockResolvedValue(scores);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: studentId,
        name: 'Test Student',
        enrollments: [],
        guardianId: null,
      });
      mockPrisma.alert.create.mockResolvedValue(createdAlert);

      await service.evaluateStudent(studentId);

      expect(mockPrisma.alert.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          studentId,
          type: 'DOWNWARD_TREND',
          status: 'ACTIVE',
        }) as object,
      });
      expect(mockReportsService.generate).toHaveBeenCalledWith(
        studentId,
        'alert-2',
      );
    });
  });
});
