import { Test, TestingModule } from '@nestjs/testing';
import { AlertsService } from './alerts.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';

describe('AlertsService', () => {
  let service: AlertsService;

  const organizationId = 'org-1';

  const mockPrisma = {
    alert: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
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
          student: {
            name: 'Jamie S.',
            enrollments: [{ class: { name: 'Biology 101' } }],
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

    it('should throw NotFoundException for non-existent alert', async () => {
      mockPrisma.alert.findFirst.mockResolvedValue(null);

      await expect(
        service.resolve('bad-id', 'RESOLVED', organizationId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when the alert belongs to another organization', async () => {
      mockPrisma.alert.findFirst.mockResolvedValue(null);

      await expect(
        service.resolve('org-b-alert', 'RESOLVED', organizationId),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.alert.findFirst).toHaveBeenCalledWith({
        where: { id: 'org-b-alert', student: { organizationId } },
      });
    });
  });
});
