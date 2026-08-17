import { Test, TestingModule } from '@nestjs/testing';
import { GroupsService } from './groups.service';
import { PrismaService } from '../prisma/prisma.service';
import { STRIPE_CLIENT } from '../billing/stripe-client';
import { ErrorCode } from '../common/errors/codes';

describe('GroupsService', () => {
  let service: GroupsService;

  const adminUser = {
    id: 'admin-1',
    organizationId: 'org-1',
  };

  const mockStripe = {
    subscriptions: {
      retrieve: jest.fn(),
      update: jest.fn(),
    },
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
    schoolGroup: {
      findUnique: jest.fn(),
      create: jest.fn(),
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
    process.env.STRIPE_PRICE_ENTERPRISE = 'price_enterprise';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GroupsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: STRIPE_CLIENT, useValue: mockStripe },
      ],
    }).compile();

    service = module.get<GroupsService>(GroupsService);
    jest.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.STRIPE_PRICE_ENTERPRISE;
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
          joinCode: 'GROUP1234',
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

    it('returns the group with join code, schools and their seat usage', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(groupedUser);

      const result = await service.findMine(adminUser as never);

      expect(result.name).toBe('Edu Chain');
      expect(result.joinCode).toBe('GROUP1234');
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
    const orgRow = {
      id: 'org-1',
      name: 'Demo School',
      groupId: null,
      stripeCustomerId: 'cus_123',
      stripeSubscriptionId: 'sub_123',
      subscriptionTier: 'PRO',
      subscriptionStatus: 'ACTIVE',
      seatLimit: 100,
    };

    function mockTransaction(
      created = { id: 'group-1', joinCode: 'GROUP1234' },
    ) {
      mockPrisma.$transaction.mockImplementation(
        (
          cb: (tx: {
            schoolGroup: { create: jest.Mock };
            organization: { update: jest.Mock };
          }) => Promise<unknown>,
        ) =>
          cb({
            schoolGroup: {
              create: jest
                .fn()
                .mockResolvedValue({ name: 'Edu Chain', ...created }),
            },
            organization: {
              update: jest.fn().mockResolvedValue({ id: 'org-1' }),
            },
          }),
      );
    }

    it('moves billing onto the group and upgrades the subscription to Enterprise', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(orgRow);
      mockTransaction();
      mockStripe.subscriptions.retrieve.mockResolvedValue({
        id: 'sub_123',
        items: { data: [{ id: 'item_1' }] },
      });
      mockStripe.subscriptions.update.mockResolvedValue({
        id: 'sub_123',
        status: 'active',
      });

      const result = await service.create(adminUser as never, 'Edu Chain');

      expect(mockPrisma.organization.findUnique).toHaveBeenCalledWith({
        where: { id: 'org-1' },
      });
      expect(mockStripe.subscriptions.retrieve).toHaveBeenCalledWith('sub_123');
      expect(mockStripe.subscriptions.update).toHaveBeenCalledWith('sub_123', {
        items: [{ id: 'item_1', price: 'price_enterprise' }],
        proration_behavior: 'create_prorations',
      });
      expect(result.requiresCheckout).toBe(false);
      expect(result.action).toBe('UPGRADED');
      expect(result.message).toContain('ready');
    });

    it('signals CHECKOUT_REQUIRED when the org has no subscription', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        ...orgRow,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
      });
      mockTransaction();

      const result = await service.create(adminUser as never, 'Edu Chain');

      expect(result.requiresCheckout).toBe(true);
      expect(result.action).toBe('CHECKOUT_REQUIRED');
      expect(mockStripe.subscriptions.retrieve).not.toHaveBeenCalled();
    });

    it('throws GROUP_ALREADY_MEMBER when the school already belongs to a group', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        ...orgRow,
        groupId: 'group-9',
      });

      await expect(
        service.create(adminUser as never, 'Edu Chain'),
      ).rejects.toMatchObject({
        code: ErrorCode.GROUP_ALREADY_MEMBER,
        status: 409,
      });
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws NotFound for a missing organization', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);

      await expect(
        service.create(adminUser as never, 'Edu Chain'),
      ).rejects.toMatchObject({
        code: ErrorCode.ORG_NOT_FOUND,
      });
    });

    it('throws PLAN_NOT_AVAILABLE when Enterprise pricing is not configured', async () => {
      delete process.env.STRIPE_PRICE_ENTERPRISE;
      mockPrisma.organization.findUnique.mockResolvedValue(orgRow);
      mockTransaction();

      await expect(
        service.create(adminUser as never, 'Edu Chain'),
      ).rejects.toMatchObject({
        code: ErrorCode.PLAN_NOT_AVAILABLE,
      });
    });
  });

  describe('join', () => {
    const orgRow = {
      id: 'org-1',
      name: 'Demo School',
      groupId: null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      subscriptionTier: 'BASIC',
      subscriptionStatus: 'ACTIVE',
      seatLimit: 30,
    };

    it('joins by code and resets the school onto group billing', async () => {
      mockPrisma.schoolGroup.findUnique.mockResolvedValue({
        id: 'group-1',
        name: 'Edu Chain',
      });
      mockPrisma.organization.findUnique.mockResolvedValue(orgRow);

      const result = await service.join(adminUser as never, 'GROUP1234');

      expect(mockPrisma.schoolGroup.findUnique).toHaveBeenCalledWith({
        where: { joinCode: 'GROUP1234' },
        select: { id: true, name: true },
      });
      expect(mockPrisma.organization.update).toHaveBeenCalledWith({
        where: { id: 'org-1' },
        data: {
          groupId: 'group-1',
          stripeCustomerId: null,
          stripeSubscriptionId: null,
          subscriptionStatus: 'TRIALING',
          subscriptionTier: 'TRIAL',
          seatLimit: null,
        },
      });
      expect(result.name).toBe('Edu Chain');
      expect(result.message).toContain('Edu Chain');
    });

    it('stops the school subscription at period end when joining', async () => {
      mockPrisma.schoolGroup.findUnique.mockResolvedValue({
        id: 'group-1',
        name: 'Edu Chain',
      });
      mockPrisma.organization.findUnique.mockResolvedValue({
        ...orgRow,
        stripeSubscriptionId: 'sub_own',
      });
      mockStripe.subscriptions.update.mockResolvedValue({
        id: 'sub_own',
        cancel_at_period_end: true,
      });

      await service.join(adminUser as never, 'GROUP1234');

      expect(mockStripe.subscriptions.update).toHaveBeenCalledWith('sub_own', {
        cancel_at_period_end: true,
      });
    });

    it('throws GROUP_NOT_FOUND for an unknown code', async () => {
      mockPrisma.schoolGroup.findUnique.mockResolvedValue(null);

      await expect(
        service.join(adminUser as never, 'NOPE0000'),
      ).rejects.toMatchObject({
        code: ErrorCode.GROUP_NOT_FOUND,
      });
      expect(mockPrisma.organization.update).not.toHaveBeenCalled();
    });

    it('throws GROUP_ALREADY_MEMBER when the school is already grouped', async () => {
      mockPrisma.schoolGroup.findUnique.mockResolvedValue({
        id: 'group-1',
        name: 'Edu Chain',
      });
      mockPrisma.organization.findUnique.mockResolvedValue({
        ...orgRow,
        groupId: 'group-1',
      });

      await expect(
        service.join(adminUser as never, 'GROUP1234'),
      ).rejects.toMatchObject({
        code: ErrorCode.GROUP_ALREADY_MEMBER,
      });
    });
  });
});
