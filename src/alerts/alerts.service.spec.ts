import { Test, TestingModule } from '@nestjs/testing';
import { AlertsService } from './alerts.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AlertsService', () => {
  let service: AlertsService;

  const organizationId = 'org-1';

  const mockPrisma = {
    alert: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    studentAnalysis: {
      findFirst: jest.fn(),
    },
    studyGeneration: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlertsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AlertsService>(AlertsService);
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return enriched alerts', async () => {
      mockPrisma.alert.findMany.mockResolvedValue([
        {
          id: 'a1',
          type: 'FAILING',
          reason: 'Low scores',
          status: 'ACTIVE',
          studentId: 's1',
          createdAt: new Date('2026-07-30'),
          offering: { id: 'o1', teacher: { id: 't1', name: 'Ms. Lee' } },
          student: {
            name: 'Jamie S.',
            grade: { id: 'g1', level: 10, name: 'Grade 10' },
            enrollments: [
              {
                section: {
                  name: 'Biology 101',
                  gradeLevel: { id: 'g1', level: 10, name: 'Grade 10' },
                },
              },
            ],
          },
          analyses: [
            {
              diagnosis: { severity: 'HIGH', hasIssue: true },
              teacherContent: { skillGaps: ['gap1', 'gap2', 'gap3'] },
            },
          ],
        },
        {
          id: 'a2',
          type: 'DOWNWARD_TREND',
          reason: 'Dropped scores',
          status: 'ACTIVE',
          studentId: 's2',
          createdAt: new Date('2026-07-28'),
          student: {
            name: 'Sam L.',
            enrollments: [],
          },
          analyses: [],
        },
      ]);

      const result = await service.findAll(undefined, organizationId);

      expect(result).toEqual([
        {
          id: 'a1',
          type: 'FAILING',
          reason: 'Low scores',
          status: 'ACTIVE',
          studentId: 's1',
          createdAt: '2026-07-30T00:00:00.000Z',
          studentName: 'Jamie S.',
          className: 'Biology 101',
          grade: { id: 'g1', level: 10, name: 'Grade 10' },
          teacherName: 'Ms. Lee',
          teacherId: 't1',
          severity: 'HIGH',
          skillGapCount: 3,
        },
        {
          id: 'a2',
          type: 'DOWNWARD_TREND',
          reason: 'Dropped scores',
          status: 'ACTIVE',
          studentId: 's2',
          createdAt: '2026-07-28T00:00:00.000Z',
          studentName: 'Sam L.',
          className: null,
          grade: null,
          teacherName: null,
          teacherId: null,
          severity: null,
          skillGapCount: 0,
        },
      ]);
    });

    it('should filter by status', async () => {
      mockPrisma.alert.findMany.mockResolvedValue([]);

      await service.findAll('ACTIVE', organizationId);

      expect(mockPrisma.alert.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'ACTIVE', student: { organizationId } },
        }),
      );
    });
  });

  describe('resolve', () => {
    it('should update alert status to RESOLVED', async () => {
      const existingAlert = { id: 'alert-id', status: 'ACTIVE' };
      const updatedAlert = { id: 'alert-id', status: 'RESOLVED' };

      mockPrisma.alert.findFirst.mockResolvedValue(existingAlert);
      mockPrisma.alert.update.mockResolvedValue(updatedAlert);

      const result = await service.resolve(
        'alert-id',
        'RESOLVED',
        organizationId,
      );

      expect(mockPrisma.alert.findFirst).toHaveBeenCalledWith({
        where: { id: 'alert-id', student: { organizationId } },
      });
      expect(mockPrisma.alert.update).toHaveBeenCalledWith({
        where: { id: 'alert-id' },
        data: { status: 'RESOLVED' },
      });
      expect(result.status).toBe('RESOLVED');
    });

    it('should update alert status to DISMISSED', async () => {
      const existingAlert = { id: 'alert-id', status: 'ACTIVE' };
      const updatedAlert = { id: 'alert-id', status: 'DISMISSED' };

      mockPrisma.alert.findFirst.mockResolvedValue(existingAlert);
      mockPrisma.alert.update.mockResolvedValue(updatedAlert);

      const result = await service.resolve(
        'alert-id',
        'DISMISSED',
        organizationId,
      );

      expect(mockPrisma.alert.update).toHaveBeenCalledWith({
        where: { id: 'alert-id' },
        data: { status: 'DISMISSED' },
      });
      expect(result.status).toBe('DISMISSED');
    });

    it('should throw for non-existent alert', async () => {
      mockPrisma.alert.findFirst.mockResolvedValue(null);

      await expect(
        service.resolve('bad-id', 'RESOLVED', organizationId),
      ).rejects.toMatchObject({ code: 'ALERT_NOT_FOUND' });
    });

    it('should throw when the alert belongs to another organization', async () => {
      mockPrisma.alert.findFirst.mockResolvedValue(null);

      await expect(
        service.resolve('org-b-alert', 'RESOLVED', organizationId),
      ).rejects.toMatchObject({ code: 'ALERT_NOT_FOUND' });
      expect(mockPrisma.alert.findFirst).toHaveBeenCalledWith({
        where: { id: 'org-b-alert', student: { organizationId } },
      });
    });
  });

  describe('getGuardianDetail', () => {
    it('returns guardian-facing content for a linked child', async () => {
      mockPrisma.studentAnalysis.findFirst.mockResolvedValue({
        alert: {
          student: { id: 'child-1', name: 'Jamie S.' },
        },
        diagnosis: { summary: 'Jamie is falling behind in math.' },
        guardianContent: {
          message: 'Hi parent, ...',
          homeSupport: ['Set a study routine'],
        },
      });

      const result = await service.getGuardianDetail('a1', 'guardian-1');

      expect(mockPrisma.studentAnalysis.findFirst).toHaveBeenCalledWith({
        where: {
          alertId: 'a1',
          alert: { student: { guardianId: 'guardian-1' } },
        },
        include: {
          alert: { include: { student: { select: { id: true, name: true } } } },
        },
      });
      expect(result).toEqual({
        studentId: 'child-1',
        studentName: 'Jamie S.',
        diagnosis: { summary: 'Jamie is falling behind in math.' },
        guardianContent: {
          message: 'Hi parent, ...',
          homeSupport: ['Set a study routine'],
        },
      });
    });

    it('throws ALERT_NOT_FOUND for alerts of other students', async () => {
      mockPrisma.studentAnalysis.findFirst.mockResolvedValue(null);

      await expect(
        service.getGuardianDetail('other-alert', 'guardian-1'),
      ).rejects.toMatchObject({ code: 'ALERT_NOT_FOUND' });
    });
  });

  describe('getTeacherDetail', () => {
    it('returns diagnosis content and recommended practice generations', async () => {
      mockPrisma.studentAnalysis.findFirst.mockResolvedValue({
        id: 'analysis-1',
        diagnosis: { severity: 'HIGH' },
        teacherContent: { analysis: 'needs support' },
        guardianContent: { message: 'hi' },
        teacherFeedback: null,
        managementSummary: null,
      });
      mockPrisma.studyGeneration.findMany.mockResolvedValue([
        {
          id: 'gen-1',
          topic: 'Using evidence',
          status: 'READY',
          stage: 'DONE',
          error: null,
          createdAt: new Date('2026-08-29'),
        },
      ]);

      const result = await service.getTeacherDetail('alert-1', organizationId);

      expect(result.recommendations).toHaveLength(1);
      expect(result.recommendations[0]).toMatchObject({
        id: 'gen-1',
        topic: 'Using evidence',
      });
    });
  });
});
