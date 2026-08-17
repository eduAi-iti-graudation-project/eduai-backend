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
      findMany: jest.fn(),
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

  describe('findByGuardian', () => {
    it("returns active alerts for the guardian's children", async () => {
      mockPrisma.alert.findMany.mockResolvedValue([
        {
          id: 'a1',
          type: 'GRADE_DROP',
          reason: 'Score dropped 15 points',
          status: 'ACTIVE',
          studentId: 'child-1',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          student: { id: 'child-1', name: 'Jamie S.' },
          analyses: [{ diagnosis: { severity: 'HIGH' } }],
        },
        {
          id: 'a2',
          type: 'ATTENDANCE',
          reason: 'Absent 3 days',
          status: 'ACTIVE',
          studentId: 'child-2',
          createdAt: new Date('2026-01-02T00:00:00Z'),
          student: { id: 'child-2', name: 'Riley T.' },
          analyses: [{ diagnosis: {} }],
        },
      ]);

      const result = await service.findByGuardian('guardian-1');

      expect(mockPrisma.alert.findMany).toHaveBeenCalledWith({
        where: { status: 'ACTIVE', student: { guardianId: 'guardian-1' } },
        include: {
          student: { select: { id: true, name: true } },
          analyses: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { diagnosis: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual([
        {
          id: 'a1',
          type: 'GRADE_DROP',
          reason: 'Score dropped 15 points',
          status: 'ACTIVE',
          studentId: 'child-1',
          createdAt: '2026-01-01T00:00:00.000Z',
          studentName: 'Jamie S.',
          severity: 'HIGH',
        },
        {
          id: 'a2',
          type: 'ATTENDANCE',
          reason: 'Absent 3 days',
          status: 'ACTIVE',
          studentId: 'child-2',
          createdAt: '2026-01-02T00:00:00.000Z',
          studentName: 'Riley T.',
          severity: null,
        },
      ]);
    });
  });

  describe('findTeacherFlags', () => {
    it('groups CLASS/BOTH analyses by offering and ranks by severity', async () => {
      mockPrisma.studentAnalysis.findMany.mockResolvedValue([
        {
          id: 'sa-1',
          alertId: 'a1',
          createdAt: new Date('2026-08-01T00:00:00Z'),
          diagnosis: {
            attribution: 'CLASS',
            severity: 'HIGH',
            reason: 'Most of the class is dropping on Newtonian mechanics.',
            brief: { headline: 'Class-wide drop in Newtonian mechanics' },
            classStats: {
              studentCount: 12,
              classAvgPct: 41,
              droppingCount: 8,
              belowAverageCount: 9,
            },
          },
          offering: {
            id: 'o1',
            course: { name: 'Physics' },
            section: { name: '10-A' },
            teacher: { id: 't1', name: 'Mr. Johnson' },
          },
        },
        {
          id: 'sa-2',
          alertId: 'a2',
          createdAt: new Date('2026-08-02T00:00:00Z'),
          diagnosis: {
            attribution: 'BOTH',
            severity: 'MEDIUM',
            reason: 'Half the class and this student are declining together.',
            classStats: {
              studentCount: 8,
              classAvgPct: 55,
              droppingCount: 4,
              belowAverageCount: 5,
            },
          },
          offering: {
            id: 'o2',
            course: { name: 'English' },
            section: { name: '11-B' },
            teacher: { id: 't2', name: 'Ms. Lee' },
          },
        },
        {
          id: 'sa-3',
          alertId: 'a3',
          createdAt: new Date('2026-08-03T00:00:00Z'),
          diagnosis: { attribution: 'STUDENT', severity: 'HIGH' },
          offering: {
            id: 'o3',
            course: { name: 'Chemistry' },
            section: { name: '10-B' },
            teacher: { id: 't3', name: 'Dr. Smith' },
          },
        },
        {
          id: 'sa-4',
          alertId: null,
          createdAt: new Date('2026-08-04T00:00:00Z'),
          diagnosis: { attribution: 'CLASS', severity: 'HIGH' },
          offering: {
            id: 'o4',
            course: { name: 'Math' },
            section: { name: '9-A' },
            teacher: { id: 't4', name: 'Ms. Brown' },
          },
        },
      ]);

      const result = await service.findTeacherFlags(organizationId);

      const queryArg = mockPrisma.studentAnalysis.findMany.mock
        .calls[0] as unknown as [
        {
          where: {
            offering: { organizationId: string };
            alertId: { not: null };
          };
        },
      ];
      expect(queryArg[0].where.offering).toEqual({ organizationId });
      expect(queryArg[0].where.alertId).toEqual({ not: null });
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        courseOfferingId: 'o1',
        teacherId: 't1',
        teacherName: 'Mr. Johnson',
        courseName: 'Physics',
        sectionName: '10-A',
        attribution: 'CLASS',
        severity: 'HIGH',
        reason: 'Most of the class is dropping on Newtonian mechanics.',
        headline: 'Class-wide drop in Newtonian mechanics',
        classStats: {
          studentCount: 12,
          classAvgPct: 41,
          droppingCount: 8,
          belowAverageCount: 9,
        },
        alertCount: 1,
      });
      expect(result[1].courseOfferingId).toBe('o2');
      expect(result[1].severity).toBe('MEDIUM');
    });

    it('falls back to legacy issueType and aggregates duplicate offerings', async () => {
      mockPrisma.studentAnalysis.findMany.mockResolvedValue([
        {
          id: 'sa-1',
          alertId: 'a1',
          createdAt: new Date('2026-08-01T00:00:00Z'),
          diagnosis: {
            issueType: 'CLASS_ISSUE',
            severity: 'HIGH',
            summary: 'Legacy class issue.',
            classStats: {
              studentCount: 5,
              classAvgPct: 44,
              droppingCount: 3,
              belowAverageCount: 4,
            },
          },
          offering: {
            id: 'o1',
            course: { name: 'History' },
            section: { name: '12-A' },
            teacher: { id: 't1', name: 'Mr. Khan' },
          },
        },
        {
          id: 'sa-2',
          alertId: 'a2',
          createdAt: new Date('2026-08-02T00:00:00Z'),
          diagnosis: {
            attribution: 'BOTH',
            severity: 'MEDIUM',
            classStats: {
              studentCount: 5,
              classAvgPct: 50,
              droppingCount: 3,
              belowAverageCount: 3,
            },
          },
          offering: {
            id: 'o1',
            course: { name: 'History' },
            section: { name: '12-A' },
            teacher: { id: 't1', name: 'Mr. Khan' },
          },
        },
      ]);

      const result = await service.findTeacherFlags(organizationId);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        courseOfferingId: 'o1',
        attribution: 'CLASS',
        severity: 'HIGH',
        reason: 'Legacy class issue.',
        alertCount: 2,
        latestAt: '2026-08-02T00:00:00.000Z',
      });
    });

    it('returns an empty list when nothing is flagged', async () => {
      mockPrisma.studentAnalysis.findMany.mockResolvedValue([]);

      const result = await service.findTeacherFlags(organizationId);

      expect(result).toEqual([]);
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
