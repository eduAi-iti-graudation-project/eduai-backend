import { Test, TestingModule } from '@nestjs/testing';
import { BillingService } from './billing.service';
import { PrismaService } from '../prisma/prisma.service';
import { STRIPE_CLIENT } from './stripe-client';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';

async function expectApiError(
  promise: Promise<unknown>,
  code: string,
  status: number,
) {
  try {
    await promise;
    fail('expected an ApiError to be thrown');
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe(code);
    expect((err as ApiError).getStatus()).toBe(status);
  }
}

describe('BillingService', () => {
  let service: BillingService;

  const mockStripe = {
    customers: {
      create: jest.fn(),
    },
    checkout: {
      sessions: {
        create: jest.fn(),
      },
    },
    subscriptions: {
      retrieve: jest.fn(),
      update: jest.fn(),
    },
    billingPortal: {
      sessions: {
        create: jest.fn(),
      },
    },
  };

  const mockPrisma = {
    organization: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    schoolGroup: {
      update: jest.fn().mockResolvedValue({ id: 'group-1' }),
    },
    user: {
      count: jest.fn(),
    },
  };

  const originalPrices = {
    basic: process.env.STRIPE_PRICE_BASIC,
    pro: process.env.STRIPE_PRICE_PRO,
    enterprise: process.env.STRIPE_PRICE_ENTERPRISE,
  };

  beforeEach(async () => {
    process.env.STRIPE_PRICE_BASIC = 'price_basic';
    process.env.STRIPE_PRICE_PRO = 'price_pro';
    process.env.STRIPE_PRICE_ENTERPRISE = 'price_enterprise';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: STRIPE_CLIENT, useValue: mockStripe },
      ],
    }).compile();

    service = module.get<BillingService>(BillingService);
    jest.clearAllMocks();
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(originalPrices)) {
      if (value === undefined) {
        delete process.env[`STRIPE_PRICE_${key.toUpperCase()}`];
      } else {
        process.env[`STRIPE_PRICE_${key.toUpperCase()}`] = value;
      }
    }
  });

  const input = {
    organizationId: 'org-1',
    planId: 'basic' as const,
    successUrl: 'https://app.example.com/success',
    cancelUrl: 'https://app.example.com/cancel',
  };

  it('creates a checkout session for an org with an existing Stripe customer', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({
      id: 'org-1',
      name: 'Demo School',
      stripeCustomerId: 'cus_123',
    });
    mockStripe.checkout.sessions.create.mockResolvedValue({
      id: 'cs_1',
      url: 'https://checkout.stripe.com/pay/cs_1',
    });

    const result = await service.createCheckoutSession(input);

    expect(mockPrisma.organization.findUnique).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      include: { group: true },
    });
    expect(mockStripe.customers.create).not.toHaveBeenCalled();
    expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith({
      mode: 'subscription',
      customer: 'cus_123',
      line_items: [{ price: 'price_basic', quantity: 1 }],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      metadata: {
        organizationId: 'org-1',
        planId: 'basic',
        groupId: null,
      },
    });
    expect(result).toEqual({ url: 'https://checkout.stripe.com/pay/cs_1' });
  });

  it('creates and persists a Stripe customer when the org has none', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({
      id: 'org-1',
      name: 'Demo School',
      stripeCustomerId: null,
    });
    mockStripe.customers.create.mockResolvedValue({ id: 'cus_new' });
    mockStripe.checkout.sessions.create.mockResolvedValue({
      id: 'cs_2',
      url: 'https://checkout.stripe.com/pay/cs_2',
    });

    const result = await service.createCheckoutSession(input);

    expect(mockStripe.customers.create).toHaveBeenCalledWith({
      name: 'Demo School',
      metadata: { organizationId: 'org-1' },
    });
    expect(mockPrisma.organization.update).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: { stripeCustomerId: 'cus_new' },
    });
    expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_new' }),
    );
    expect(result.url).toBe('https://checkout.stripe.com/pay/cs_2');
  });

  it('throws BadRequest for a plan outside the catalog', async () => {
    await expectApiError(
      service.createCheckoutSession({
        ...input,
        planId: 'gold' as unknown as 'basic',
      }),
      ErrorCode.PLAN_NOT_AVAILABLE,
      400,
    );
    expect(mockPrisma.organization.findUnique).not.toHaveBeenCalled();
  });

  it('throws BadRequest when the plan price is not configured', async () => {
    delete process.env.STRIPE_PRICE_BASIC;
    const service = new BillingService(
      mockPrisma as never,
      mockStripe as never,
    );

    await expectApiError(
      service.createCheckoutSession(input),
      ErrorCode.PLAN_NOT_AVAILABLE,
      400,
    );
  });

  it('throws NotFound for a missing organization', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue(null);

    await expectApiError(
      service.createCheckoutSession(input),
      ErrorCode.ORG_NOT_FOUND,
      404,
    );
  });

  describe('changePlan', () => {
    const changeInput = {
      organizationId: 'org-1',
      planId: 'pro' as const,
      atPeriodEnd: false,
    };

    it('throws BadRequest when the organization has no subscription', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        name: 'Demo School',
        stripeSubscriptionId: null,
      });

      await expectApiError(
        service.changePlan(changeInput),
        ErrorCode.BILLING_NO_SUBSCRIPTION,
        400,
      );
      expect(mockStripe.subscriptions.retrieve).not.toHaveBeenCalled();
    });

    it('updates the subscription item with proration', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        name: 'Demo School',
        stripeSubscriptionId: 'sub_123',
      });
      mockStripe.subscriptions.retrieve.mockResolvedValue({
        id: 'sub_123',
        items: { data: [{ id: 'item_1', price: { id: 'price_basic' } }] },
        status: 'active',
        cancel_at_period_end: false,
      });
      mockStripe.subscriptions.update.mockResolvedValue({
        id: 'sub_123',
        status: 'active',
        cancel_at_period_end: false,
      });

      const result = await service.changePlan(changeInput);

      expect(mockStripe.subscriptions.retrieve).toHaveBeenCalledWith('sub_123');
      expect(mockStripe.subscriptions.update).toHaveBeenCalledWith('sub_123', {
        items: [{ id: 'item_1', price: 'price_pro' }],
        proration_behavior: 'create_prorations',
      });
      expect(result).toEqual({
        planId: 'pro',
        status: 'active',
        cancelAtPeriodEnd: false,
      });
    });

    it('skips proration when atPeriodEnd is requested', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        name: 'Demo School',
        stripeSubscriptionId: 'sub_123',
      });
      mockStripe.subscriptions.retrieve.mockResolvedValue({
        id: 'sub_123',
        items: { data: [{ id: 'item_1' }] },
        status: 'active',
        cancel_at_period_end: false,
      });
      mockStripe.subscriptions.update.mockResolvedValue({
        id: 'sub_123',
        status: 'active',
        cancel_at_period_end: true,
      });

      await service.changePlan({ ...changeInput, atPeriodEnd: true });

      expect(mockStripe.subscriptions.update).toHaveBeenCalledWith('sub_123', {
        items: [{ id: 'item_1', price: 'price_pro' }],
        proration_behavior: 'none',
      });
    });

    it('throws BadRequest when the plan price is not configured', async () => {
      delete process.env.STRIPE_PRICE_PRO;
      const fresh = new BillingService(
        mockPrisma as never,
        mockStripe as never,
      );

      await expectApiError(
        fresh.changePlan(changeInput),
        ErrorCode.PLAN_NOT_AVAILABLE,
        400,
      );
      expect(mockPrisma.organization.findUnique).not.toHaveBeenCalled();
    });

    it('throws BadRequest when the subscription has no items', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        name: 'Demo School',
        stripeSubscriptionId: 'sub_123',
      });
      mockStripe.subscriptions.retrieve.mockResolvedValue({
        id: 'sub_123',
        items: { data: [] },
      });

      await expectApiError(
        service.changePlan(changeInput),
        ErrorCode.BILLING_NO_ITEMS,
        400,
      );
    });
  });

  describe('createBillingPortalSession', () => {
    const portalInput = {
      organizationId: 'org-1',
      returnUrl: 'https://app.example.com/settings',
    };

    it('creates a portal session for an org with a Stripe customer', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        name: 'Demo School',
        stripeCustomerId: 'cus_123',
      });
      mockStripe.billingPortal.sessions.create.mockResolvedValue({
        id: 'bps_1',
        url: 'https://billing.stripe.com/session/bps_1',
      });

      const result = await service.createBillingPortalSession(portalInput);

      expect(mockStripe.billingPortal.sessions.create).toHaveBeenCalledWith({
        customer: 'cus_123',
        return_url: 'https://app.example.com/settings',
      });
      expect(result).toEqual({
        url: 'https://billing.stripe.com/session/bps_1',
      });
    });

    it('creates a customer first when the org has none', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        name: 'Demo School',
        stripeCustomerId: null,
      });
      mockStripe.customers.create.mockResolvedValue({ id: 'cus_new' });
      mockStripe.billingPortal.sessions.create.mockResolvedValue({
        id: 'bps_2',
        url: 'https://billing.stripe.com/session/bps_2',
      });

      const result = await service.createBillingPortalSession(portalInput);

      expect(mockStripe.customers.create).toHaveBeenCalledWith({
        name: 'Demo School',
        metadata: { organizationId: 'org-1' },
      });
      expect(mockPrisma.organization.update).toHaveBeenCalledWith({
        where: { id: 'org-1' },
        data: { stripeCustomerId: 'cus_new' },
      });
      expect(result.url).toBe('https://billing.stripe.com/session/bps_2');
    });

    it('throws NotFound for a missing organization', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);

      await expectApiError(
        service.createBillingPortalSession(portalInput),
        ErrorCode.ORG_NOT_FOUND,
        404,
      );
    });
  });

  describe('SchoolGroup resolution (WP5)', () => {
    const groupedOrg = {
      id: 'org-1',
      name: 'Demo School',
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      groupId: 'group-1',
      group: {
        id: 'group-1',
        name: 'Edu Chain',
        stripeCustomerId: 'cus_group',
        stripeSubscriptionId: 'sub_group',
      },
    };

    function mockSchoolGroupUpdate() {
      return mockPrisma.schoolGroup.update;
    }

    it('rejects a non-Enterprise checkout for a grouped school', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(groupedOrg);

      await expectApiError(
        service.createCheckoutSession(input),
        ErrorCode.GROUP_REQUIRES_ENTERPRISE,
        403,
      );
      expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it('uses the group customer for checkout and never persists to the org', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(groupedOrg);
      mockStripe.checkout.sessions.create.mockResolvedValue({
        id: 'cs_g',
        url: 'https://checkout.stripe.com/pay/cs_g',
      });

      const result = await service.createCheckoutSession({
        ...input,
        planId: 'enterprise',
      });

      expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: 'cus_group',
          metadata: {
            organizationId: 'org-1',
            planId: 'enterprise',
            groupId: 'group-1',
          },
        }),
      );
      expect(mockStripe.customers.create).not.toHaveBeenCalled();
      expect(result.url).toBe('https://checkout.stripe.com/pay/cs_g');
    });

    it('persists a new Stripe customer onto the group, not the org', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        ...groupedOrg,
        group: { ...groupedOrg.group, stripeCustomerId: null },
      });
      mockStripe.customers.create.mockResolvedValue({ id: 'cus_new' });
      const update = mockSchoolGroupUpdate();

      await service.createBillingPortalSession({
        organizationId: 'org-1',
        returnUrl: 'https://app.example.com/settings',
      });

      expect(update).toHaveBeenCalledWith({
        where: { id: 'group-1' },
        data: { stripeCustomerId: 'cus_new' },
      });
    });

    it('changes the plan through the group subscription', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        ...groupedOrg,
        group: { ...groupedOrg.group, stripeSubscriptionId: 'sub_group' },
      });
      mockStripe.subscriptions.retrieve.mockResolvedValue({
        id: 'sub_group',
        items: { data: [{ id: 'item_g', price: { id: 'price_basic' } }] },
        status: 'active',
        cancel_at_period_end: false,
      });
      mockStripe.subscriptions.update.mockResolvedValue({
        id: 'sub_group',
        status: 'active',
        cancel_at_period_end: false,
      });

      await service.changePlan({
        organizationId: 'org-1',
        planId: 'enterprise',
        atPeriodEnd: false,
      });

      expect(mockStripe.subscriptions.retrieve).toHaveBeenCalledWith(
        'sub_group',
      );
    });

    it('throws GROUP_REQUIRES_ENTERPRISE when a group is downgraded', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        ...groupedOrg,
        group: { ...groupedOrg.group, stripeSubscriptionId: 'sub_group' },
      });

      await expectApiError(
        service.changePlan({
          organizationId: 'org-1',
          planId: 'basic',
          atPeriodEnd: false,
        }),
        ErrorCode.GROUP_REQUIRES_ENTERPRISE,
        403,
      );
      expect(mockStripe.subscriptions.retrieve).not.toHaveBeenCalled();
    });

    it('throws BILLING_NO_SUBSCRIPTION when neither the group nor the org has one', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        ...groupedOrg,
        group: { ...groupedOrg.group, stripeSubscriptionId: null },
        stripeSubscriptionId: null,
      });

      await expectApiError(
        service.changePlan({
          organizationId: 'org-1',
          planId: 'enterprise',
          atPeriodEnd: false,
        }),
        ErrorCode.BILLING_NO_SUBSCRIPTION,
        400,
      );
    });
  });

  describe('getPlans', () => {
    it('returns the public catalog with the agreed matrix', () => {
      const result = service.getPlans();

      expect(result.trial.days).toBe(14);
      expect(result.plans.map((plan) => plan.id)).toEqual([
        'basic',
        'pro',
        'enterprise',
      ]);
      const byId = Object.fromEntries(
        result.plans.map((plan) => [plan.id, plan]),
      );
      expect(byId.basic.price).toBe(50);
      expect(byId.basic.seatLimit).toBe(30);
      expect(byId.pro.price).toBe(120);
      expect(byId.pro.seatLimit).toBe(100);
      expect(byId.enterprise.price).toBe(300);
      expect(byId.enterprise.seatLimit).toBe(500);
      expect(byId.enterprise.features).toEqual(
        expect.arrayContaining(byId.pro.features),
      );
      expect(byId.basic.features.length).toBeGreaterThan(0);
      expect(byId.basic.available).toBe(true);
    });

    it('flags a plan as unavailable when its price is not configured', () => {
      delete process.env.STRIPE_PRICE_ENTERPRISE;

      const result = service.getPlans();
      const enterprise = result.plans.find((plan) => plan.id === 'enterprise');

      expect(enterprise?.available).toBe(false);
    });
  });

  describe('getBillingStatus', () => {
    it('returns tier, status, seats and trial end for a lone org', async () => {
      const createdAt = new Date('2026-08-01T00:00:00.000Z');
      mockPrisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        name: 'Demo School',
        subscriptionTier: 'TRIAL',
        subscriptionStatus: 'TRIALING',
        seatLimit: null,
        createdAt,
        group: null,
      });
      mockPrisma.user.count.mockResolvedValue(12);

      const result = await service.getBillingStatus('org-1');

      expect(result.tier).toBe('TRIAL');
      expect(result.status).toBe('TRIALING');
      expect(result.seatLimit).toBeNull();
      expect(result.seatUsage).toBe(12);
      expect(result.planId).toBeNull();
      expect(result.trialEndsAt).toBe('2026-08-15T00:00:00.000Z');
      expect(mockPrisma.user.count).toHaveBeenCalledWith({
        where: { organizationId: 'org-1' },
      });
    });

    it('returns no trialEndsAt for an active subscription', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        name: 'Demo School',
        subscriptionTier: 'PRO',
        subscriptionStatus: 'ACTIVE',
        seatLimit: 100,
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        group: null,
      });
      mockPrisma.user.count.mockResolvedValue(42);

      const result = await service.getBillingStatus('org-1');

      expect(result.planId).toBe('pro');
      expect(result.seatLimit).toBe(100);
      expect(result.seatUsage).toBe(42);
      expect(result.trialEndsAt).toBeNull();
    });

    it('counts seats across every school in a SchoolGroup', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        name: 'Demo School',
        subscriptionTier: 'BASIC',
        subscriptionStatus: 'ACTIVE',
        seatLimit: 30,
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        group: {
          id: 'group-1',
          name: 'Edu Chain',
          subscriptionTier: 'PRO',
          subscriptionStatus: 'ACTIVE',
          seatLimit: 100,
          createdAt: new Date('2026-08-01T00:00:00.000Z'),
          organizations: [{ id: 'org-1' }, { id: 'org-2' }],
        },
      });
      mockPrisma.user.count.mockResolvedValue(77);

      const result = await service.getBillingStatus('org-1');

      expect(result.tier).toBe('PRO');
      expect(result.planId).toBe('pro');
      expect(result.seatLimit).toBeNull();
      expect(result.availablePlans.plans).toHaveLength(1);
      expect(result.availablePlans.plans[0].id).toBe('enterprise');
      expect(mockPrisma.user.count).toHaveBeenCalledWith({
        where: { organizationId: { in: ['org-1', 'org-2'] } },
      });
    });

    it('throws NotFound for a missing organization', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);

      await expectApiError(
        service.getBillingStatus('nope'),
        ErrorCode.ORG_NOT_FOUND,
        404,
      );
    });
  });
});
