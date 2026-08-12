import { Test, TestingModule } from '@nestjs/testing';
import { GroupsService } from './groups.service';
import { PrismaService } from '../prisma/prisma.service';
import { ErrorCode } from '../common/errors/codes';

describe('GroupsService', () => {
  let service: GroupsService;

  const adminUser = {
    id: 'admin-1',
    organizationId: 'org-1',
  };

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    organization: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    alert: {
      count: jest.fn(),
    },
    quizAttempt: {
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GroupsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<GroupsService>(GroupsService);
    jest.clearAllMocks();
  });

  describe('findMine', () => {
    const groupedUser = {
      id: 'admin-1',
      organizationId: 'org-1',
      organization: {
        id: 'org-1',
        groupId: 'group-1',
        group: {
          id: 'group-1',
          name: 'Edu Chain',
          subscriptionTier: 'PRO',
          subscriptionStatus: 'ACTIVE',
          seatLimit: 100,
          organizations: [
            {
              id: 'org-1',
              name: 'Demo School',
              joinCode: 'DEMO2026',
              _count: { users: 42 },
            },
            {
              id: 'org-2',
              name: 'Branch School',
              joinCode: 'BRANCH26',
              _count: { users: 17 },
            },
          ],
        },
      },
    };

    it('returns the group with schools and their seat usage', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(groupedUser);

      const result = await service.findMine(adminUser as never);

      expect(result.name).toBe('Edu Chain');
      expect(result.schools).toHaveLength(2);
      expect(result.schools[0]).toEqual({
        id: 'org-1',
        name: 'Demo School',
        joinCode: 'DEMO2026',
        seatUsage: 42,
        subscriptionTier: 'PRO',
      });
    });

    it('throws GROUP_NOT_FOUND when the school is not grouped', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'admin-1',
        organizationId: 'org-1',
        organization: { id: 'org-1', groupId: null, group: null },
      });

      await expect(service.findMine(adminUser as never)).rejects.toMatchObject({
        code: ErrorCode.GROUP_NOT_FOUND,
      });
    });
  });

  describe('insights', () => {
    it('aggregates per-school stats and group totals', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'admin-1',
        organizationId: 'org-1',
        organization: {
          id: 'org-1',
          groupId: 'group-1',
          group: {
            id: 'group-1',
            name: 'Edu Chain',
            organizations: [
              { id: 'org-1', name: 'Demo School', _count: { users: 42 } },
              { id: 'org-2', name: 'Branch School', _count: { users: 17 } },
            ],
          },
        },
      });
      mockPrisma.user.count.mockResolvedValue(10);
      mockPrisma.alert.count.mockResolvedValue(2);
      mockPrisma.quizAttempt.count.mockResolvedValue(5);

      const result = await service.insights(adminUser as never);

      expect(result.schools).toHaveLength(2);
      expect(result.schools[0]).toEqual({
        id: 'org-1',
        name: 'Demo School',
        users: 42,
        students: 10,
        teachers: 10,
        activeAlerts: 2,
        quizAttempts: 5,
      });
      expect(result.totals).toEqual({
        users: 59,
        students: 20,
        teachers: 20,
        activeAlerts: 4,
        quizAttempts: 10,
      });
    });
  });

  describe('create', () => {
    it('moves billing fields onto the group and nulls them on the org', async () => {
      const orgRow = {
        id: 'org-1',
        name: 'Demo School',
        stripeCustomerId: 'cus_123',
        stripeSubscriptionId: 'sub_123',
        subscriptionTier: 'PRO',
        subscriptionStatus: 'ACTIVE',
        seatLimit: 100,
      };
      mockPrisma.$transaction.mockImplementation(
        (
          cb: (tx: {
            organization: { findUnique: jest.Mock; update: jest.Mock };
            schoolGroup: { create: jest.Mock };
          }) => Promise<unknown>,
        ) =>
          cb({
            organization: {
              findUnique: jest.fn().mockResolvedValue(orgRow),
              update: jest.fn().mockResolvedValue({ id: 'org-1' }),
            },
            schoolGroup: {
              create: jest
                .fn()
                .mockResolvedValue({ id: 'group-1', name: 'Edu Chain' }),
            },
          }),
      );

      const result = await service.create(adminUser as never, 'Edu Chain');

      expect(result.id).toBe('group-1');
      expect(result.message).toContain('ready');
    });
  });
});
