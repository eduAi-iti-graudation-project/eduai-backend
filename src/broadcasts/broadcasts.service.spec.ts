import { Test, TestingModule } from '@nestjs/testing';
import { BroadcastsService } from './broadcasts.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { User } from '@prisma/client';

describe('BroadcastsService', () => {
  let service: BroadcastsService;

  const admin = {
    id: 'admin-1',
    role: 'ADMIN',
    organizationId: 'org-1',
  } as User;

  const broadcastRow = {
    id: 'bc-1',
    title: 'School closed Monday',
    body: 'Due to maintenance.',
    targetRoles: ['TEACHER', 'GUARDIAN'],
    targetGradeId: null,
    createdById: 'admin-1',
    organizationId: 'org-1',
    deliveredCount: 2,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    createdBy: { name: 'Admin A' },
    grade: null,
  };

  const mockPrisma = {
    user: { findMany: jest.fn() },
    broadcast: {
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
  };

  const mockNotifications = {
    notifyMany: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BroadcastsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();

    service = module.get<BroadcastsService>(BroadcastsService);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('rejects an admin without an organization', async () => {
      await expect(
        service.create(
          { ...admin, organizationId: null },
          {
            title: 'x',
            targetRoles: ['STUDENT'],
          },
        ),
      ).rejects.toMatchObject({ code: 'ORG_FORBIDDEN' });
      expect(mockPrisma.broadcast.create).not.toHaveBeenCalled();
    });

    it('resolves the audience by role and grade, fans out notifications and records deliveredCount', async () => {
      mockPrisma.user.findMany.mockResolvedValue([
        { id: 'teacher-1' },
        { id: 'teacher-2' },
      ]);
      mockPrisma.broadcast.create.mockResolvedValue({
        ...broadcastRow,
        deliveredCount: 0,
      });
      mockPrisma.broadcast.update.mockResolvedValue(broadcastRow);
      mockPrisma.broadcast.findFirst.mockResolvedValue(broadcastRow);
      mockNotifications.notifyMany.mockResolvedValue(2);

      const result = await service.create(admin, {
        title: 'School closed Monday',
        body: 'Due to maintenance.',
        targetRoles: ['TEACHER'],
      });

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: 'org-1',
            OR: [{ role: 'TEACHER' }],
          },
        }),
      );
      expect(mockPrisma.broadcast.create).toHaveBeenCalledWith({
        data: {
          title: 'School closed Monday',
          body: 'Due to maintenance.',
          targetRoles: ['TEACHER'],
          targetGradeId: null,
          createdById: 'admin-1',
          organizationId: 'org-1',
          deliveredCount: 0,
        },
      });
      expect(mockNotifications.notifyMany).toHaveBeenCalledWith(
        ['teacher-1', 'teacher-2'],
        'BROADCAST',
        'School closed Monday',
        'Due to maintenance.',
      );
      expect(mockPrisma.broadcast.update).toHaveBeenCalledWith({
        where: { id: 'bc-1' },
        data: { deliveredCount: 2 },
      });
      expect(result.deliveredCount).toBe(2);
    });

    it('scopes guardian audience to wards of the target grade', async () => {
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'guardian-1' }]);
      mockPrisma.broadcast.create.mockResolvedValue({
        ...broadcastRow,
        deliveredCount: 0,
      });
      mockPrisma.broadcast.update.mockResolvedValue(broadcastRow);
      mockPrisma.broadcast.findFirst.mockResolvedValue(broadcastRow);
      mockNotifications.notifyMany.mockResolvedValue(1);

      await service.create(admin, {
        title: 'Assembly',
        targetRoles: ['GUARDIAN'],
        targetGradeId: 'grade-1',
      });

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: 'org-1',
            OR: [
              {
                role: 'GUARDIAN',
                wards: { some: { gradeId: 'grade-1' } },
              },
            ],
          },
        }),
      );
    });

    it('stores deliveredCount 0 when the audience is empty', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.broadcast.create.mockResolvedValue({
        ...broadcastRow,
        deliveredCount: 0,
      });
      mockPrisma.broadcast.findFirst.mockResolvedValue({
        ...broadcastRow,
        deliveredCount: 0,
      });

      const result = await service.create(admin, {
        title: 'Quiet announcement',
        targetRoles: ['ADMIN'],
      });

      expect(mockNotifications.notifyMany).not.toHaveBeenCalled();
      expect(mockPrisma.broadcast.update).not.toHaveBeenCalled();
      expect(result.deliveredCount).toBe(0);
    });
  });

  describe('findAll', () => {
    it('returns broadcasts scoped to the organization with display metadata', async () => {
      mockPrisma.broadcast.findMany.mockResolvedValue([
        broadcastRow,
        {
          ...broadcastRow,
          id: 'bc-2',
          targetGradeId: 'grade-1',
          grade: { name: 'Grade 9', level: 9 },
        },
      ]);

      const result = await service.findAll('org-1');

      expect(mockPrisma.broadcast.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: 'org-1' } }),
      );
      expect(result).toHaveLength(2);
      expect(result[0].createdByName).toBe('Admin A');
      expect(result[1].targetGradeName).toBe('Grade 9');
      expect(result[1].targetGradeLevel).toBe(9);
    });
  });
});
