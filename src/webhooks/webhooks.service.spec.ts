import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { WebhooksService } from './webhooks.service';
import { PrismaService } from '../prisma/prisma.service';
import { STRIPE_CLIENT } from '../billing/stripe-client';
import { NotificationsService } from '../notifications/notifications.service';

describe('WebhooksService', () => {
  let service: WebhooksService;

  const mockStripe = {
    webhooks: {
      constructEvent: jest.fn(),
    },
  };

  const mockPrisma = {
    subscriptionEvent: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    organization: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    schoolGroup: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockNotifications = {
    notifyUser: jest.fn(),
  };

  const originalSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const originalPrices = {
    basic: process.env.STRIPE_PRICE_BASIC,
    pro: process.env.STRIPE_PRICE_PRO,
    enterprise: process.env.STRIPE_PRICE_ENTERPRISE,
  };

  beforeEach(async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    process.env.STRIPE_PRICE_BASIC = 'price_basic';
    process.env.STRIPE_PRICE_PRO = 'price_pro';
    process.env.STRIPE_PRICE_ENTERPRISE = 'price_enterprise';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: STRIPE_CLIENT, useValue: mockStripe },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();

    service = module.get<WebhooksService>(WebhooksService);
    jest.clearAllMocks();

    mockPrisma.$transaction.mockImplementation(
      (
        cb: (tx: {
          subscriptionEvent: typeof mockPrisma.subscriptionEvent;
          organization: typeof mockPrisma.organization;
          schoolGroup: typeof mockPrisma.schoolGroup;
        }) => Promise<unknown>,
      ) =>
        cb({
          subscriptionEvent: mockPrisma.subscriptionEvent,
          organization: mockPrisma.organization,
          schoolGroup: mockPrisma.schoolGroup,
        }),
    );
    mockPrisma.organization.update.mockResolvedValue({ id: 'org-1' });
    mockPrisma.schoolGroup.update.mockResolvedValue({ id: 'group-1' });
    mockPrisma.schoolGroup.findFirst.mockResolvedValue(null);
    mockPrisma.subscriptionEvent.create.mockResolvedValue({ id: 'evt-row' });
    mockPrisma.user.findMany.mockResolvedValue([
      { id: 'admin-1' },
      { id: 'admin-2' },
    ]);
    mockNotifications.notifyUser.mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.STRIPE_WEBHOOK_SECRET;
    } else {
      process.env.STRIPE_WEBHOOK_SECRET = originalSecret;
    }
    for (const [key, value] of Object.entries(originalPrices)) {
      if (value === undefined) {
        delete process.env[`STRIPE_PRICE_${key.toUpperCase()}`];
      } else {
        process.env[`STRIPE_PRICE_${key.toUpperCase()}`] = value;
      }
    }
  });

  function event(type: string, data: Record<string, unknown>) {
    return { id: `evt_${type}`, type, data: { object: data } };
  }

  it('throws for an invalid signature', async () => {
    mockStripe.webhooks.constructEvent.mockImplementation(() => {
      throw new Error('Signature verification failed');
    });

    await expect(
      service.handleStripeEvent(Buffer.from('{}'), 'bad-signature'),
    ).rejects.toMatchObject({ code: 'WEBHOOK_INVALID_SIGNATURE' });
    expect(mockPrisma.subscriptionEvent.findUnique).not.toHaveBeenCalled();
  });

  it('throws when the webhook secret is missing', async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;

    await expect(
      service.handleStripeEvent(Buffer.from('{}'), 'sig'),
    ).rejects.toMatchObject({ code: 'WEBHOOK_UNCONFIGURED' });
  });

  it('is idempotent: skips already-processed events', async () => {
    mockStripe.webhooks.constructEvent.mockReturnValue(
      event('checkout.session.completed', { metadata: {} }),
    );
    mockPrisma.subscriptionEvent.findUnique.mockResolvedValue({ id: 'row' });

    const result = await service.handleStripeEvent(
      Buffer.from('{}'),
      'valid-sig',
    );

    expect(result).toEqual({ received: true, duplicate: true });
    expect(mockPrisma.organization.update).not.toHaveBeenCalled();
  });

  it('activates the org and records the event on checkout.session.completed', async () => {
    mockStripe.webhooks.constructEvent.mockReturnValue(
      event('checkout.session.completed', {
        metadata: { organizationId: 'org-1', planId: 'basic' },
        subscription: 'sub_123',
      }),
    );
    mockPrisma.subscriptionEvent.findUnique.mockResolvedValue(null);

    const result = await service.handleStripeEvent(
      Buffer.from('{}'),
      'valid-sig',
    );

    expect(result).toEqual({ received: true });
    expect(mockPrisma.subscriptionEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-1',
        stripeEventId: 'evt_checkout.session.completed',
        type: 'checkout.session.completed',
      }) as object,
    });
    expect(mockPrisma.organization.update).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: {
        subscriptionStatus: 'ACTIVE',
        subscriptionTier: 'BASIC',
        seatLimit: 30,
        stripeSubscriptionId: 'sub_123',
      },
    });
  });

  it('ignores checkout events without a valid plan in metadata', async () => {
    mockStripe.webhooks.constructEvent.mockReturnValue(
      event('checkout.session.completed', {
        metadata: { organizationId: 'org-1', planId: 'mystery' },
      }),
    );
    mockPrisma.subscriptionEvent.findUnique.mockResolvedValue(null);

    const result = await service.handleStripeEvent(
      Buffer.from('{}'),
      'valid-sig',
    );

    expect(result).toEqual({ received: true, ignored: true });
    expect(mockPrisma.organization.update).not.toHaveBeenCalled();
  });

  it('ignores a group checkout for a non-Enterprise plan (no downgrades)', async () => {
    mockStripe.webhooks.constructEvent.mockReturnValue(
      event('checkout.session.completed', {
        metadata: {
          organizationId: 'org-1',
          planId: 'pro',
          groupId: 'group-1',
        },
        subscription: 'sub_123',
      }),
    );
    mockPrisma.subscriptionEvent.findUnique.mockResolvedValue(null);

    const result = await service.handleStripeEvent(
      Buffer.from('{}'),
      'valid-sig',
    );

    expect(result).toEqual({ received: true, ignored: true });
    expect(mockPrisma.organization.update).not.toHaveBeenCalled();
    expect(mockPrisma.schoolGroup.update).not.toHaveBeenCalled();
  });

  it('activates the group with unlimited seats on an Enterprise checkout', async () => {
    mockStripe.webhooks.constructEvent.mockReturnValue(
      event('checkout.session.completed', {
        metadata: {
          organizationId: 'org-1',
          planId: 'enterprise',
          groupId: 'group-1',
        },
        subscription: 'sub_123',
      }),
    );
    mockPrisma.subscriptionEvent.findUnique.mockResolvedValue(null);

    const result = await service.handleStripeEvent(
      Buffer.from('{}'),
      'valid-sig',
    );

    expect(result).toEqual({ received: true });
    expect(mockPrisma.schoolGroup.update).toHaveBeenCalledWith({
      where: { id: 'group-1' },
      data: {
        subscriptionStatus: 'ACTIVE',
        subscriptionTier: 'ENTERPRISE',
        seatLimit: null,
        stripeSubscriptionId: 'sub_123',
      },
    });
    expect(mockPrisma.organization.update).not.toHaveBeenCalled();
  });

  it('marks the org PAST_DUE on invoice.payment_failed', async () => {
    mockStripe.webhooks.constructEvent.mockReturnValue(
      event('invoice.payment_failed', { customer: 'cus_123' }),
    );
    mockPrisma.subscriptionEvent.findUnique.mockResolvedValue(null);
    mockPrisma.organization.findFirst.mockResolvedValue({
      id: 'org-1',
      stripeCustomerId: 'cus_123',
    });

    const result = await service.handleStripeEvent(
      Buffer.from('{}'),
      'valid-sig',
    );

    expect(mockPrisma.organization.findFirst).toHaveBeenCalledWith({
      where: { stripeCustomerId: 'cus_123' },
      select: { id: true, subscriptionStatus: true, groupId: true },
    });
    expect(mockPrisma.organization.update).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: { subscriptionStatus: 'PAST_DUE' },
    });
    expect(result).toEqual({ received: true });
  });

  it('cancels the org on customer.subscription.deleted', async () => {
    mockStripe.webhooks.constructEvent.mockReturnValue(
      event('customer.subscription.deleted', { customer: 'cus_123' }),
    );
    mockPrisma.subscriptionEvent.findUnique.mockResolvedValue(null);
    mockPrisma.organization.findFirst.mockResolvedValue({
      id: 'org-1',
      stripeCustomerId: 'cus_123',
    });

    const result = await service.handleStripeEvent(
      Buffer.from('{}'),
      'valid-sig',
    );

    expect(mockPrisma.organization.update).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: { subscriptionStatus: 'CANCELED' },
    });
    expect(result).toEqual({ received: true });
  });

  it('resolves the SchoolGroup first and updates group billing on payment_failed', async () => {
    mockStripe.webhooks.constructEvent.mockReturnValue(
      event('invoice.payment_failed', { customer: 'cus_123' }),
    );
    mockPrisma.subscriptionEvent.findUnique.mockResolvedValue(null);
    mockPrisma.schoolGroup.findFirst.mockResolvedValue({
      id: 'group-1',
      organizations: [
        { id: 'org-1', subscriptionStatus: 'ACTIVE', groupId: 'group-1' },
      ],
    });

    const result = await service.handleStripeEvent(
      Buffer.from('{}'),
      'valid-sig',
    );

    expect(mockPrisma.schoolGroup.findFirst).toHaveBeenCalledWith({
      where: { stripeCustomerId: 'cus_123' },
      include: {
        organizations: { orderBy: { createdAt: 'asc' }, take: 1 },
      },
    });
    expect(mockPrisma.schoolGroup.update).toHaveBeenCalledWith({
      where: { id: 'group-1' },
      data: { subscriptionStatus: 'PAST_DUE' },
    });
    expect(result).toEqual({ received: true });
  });

  it('swallows a concurrent P2002 race while persisting', async () => {
    mockStripe.webhooks.constructEvent.mockReturnValue(
      event('checkout.session.completed', {
        metadata: { organizationId: 'org-1', planId: 'pro' },
      }),
    );
    mockPrisma.subscriptionEvent.findUnique.mockResolvedValue(null);
    mockPrisma.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    const result = await service.handleStripeEvent(
      Buffer.from('{}'),
      'valid-sig',
    );

    expect(result).toEqual({ received: true });
  });

  it('returns unhandled for unknown event types without persisting', async () => {
    mockStripe.webhooks.constructEvent.mockReturnValue(
      event('charge.succeeded', { id: 'ch_1' }),
    );
    mockPrisma.subscriptionEvent.findUnique.mockResolvedValue(null);

    const result = await service.handleStripeEvent(
      Buffer.from('{}'),
      'valid-sig',
    );

    expect(result).toEqual({ received: true, unhandled: 'charge.succeeded' });
    expect(mockPrisma.subscriptionEvent.create).not.toHaveBeenCalled();
  });

  it('syncs tier and seat limit on customer.subscription.updated', async () => {
    mockStripe.webhooks.constructEvent.mockReturnValue(
      event('customer.subscription.updated', {
        id: 'sub_123',
        customer: 'cus_123',
        items: { data: [{ price: { id: 'price_pro' } }] },
      }),
    );
    mockPrisma.subscriptionEvent.findUnique.mockResolvedValue(null);
    mockPrisma.organization.findFirst.mockResolvedValue({
      id: 'org-1',
      stripeCustomerId: 'cus_123',
      subscriptionStatus: 'ACTIVE',
    });

    const result = await service.handleStripeEvent(
      Buffer.from('{}'),
      'valid-sig',
    );

    expect(mockPrisma.organization.update).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: {
        subscriptionStatus: 'ACTIVE',
        subscriptionTier: 'PRO',
        seatLimit: 100,
        stripeSubscriptionId: 'sub_123',
      },
    });
    expect(result).toEqual({ received: true });
  });

  it('ignores subscription.updated events with an unknown price', async () => {
    mockStripe.webhooks.constructEvent.mockReturnValue(
      event('customer.subscription.updated', {
        customer: 'cus_123',
        items: { data: [{ price: { id: 'price_unknown' } }] },
      }),
    );
    mockPrisma.subscriptionEvent.findUnique.mockResolvedValue(null);
    mockPrisma.organization.findFirst.mockResolvedValue({
      id: 'org-1',
      stripeCustomerId: 'cus_123',
      subscriptionStatus: 'ACTIVE',
    });

    const result = await service.handleStripeEvent(
      Buffer.from('{}'),
      'valid-sig',
    );

    expect(result).toEqual({ received: true, ignored: true });
    expect(mockPrisma.organization.update).not.toHaveBeenCalled();
  });

  it('ignores a group downgrade pushed directly in Stripe', async () => {
    mockStripe.webhooks.constructEvent.mockReturnValue(
      event('customer.subscription.updated', {
        id: 'sub_123',
        customer: 'cus_123',
        items: { data: [{ price: { id: 'price_pro' } }] },
      }),
    );
    mockPrisma.subscriptionEvent.findUnique.mockResolvedValue(null);
    mockPrisma.schoolGroup.findFirst.mockResolvedValue({
      id: 'group-1',
      organizations: [
        { id: 'org-1', subscriptionStatus: 'ACTIVE', groupId: 'group-1' },
      ],
    });

    const result = await service.handleStripeEvent(
      Buffer.from('{}'),
      'valid-sig',
    );

    expect(result).toEqual({ received: true, ignored: true });
    expect(mockPrisma.schoolGroup.update).not.toHaveBeenCalled();
    expect(mockPrisma.organization.update).not.toHaveBeenCalled();
  });

  it('keeps a group at Enterprise with unlimited seats on subscription.updated', async () => {
    mockStripe.webhooks.constructEvent.mockReturnValue(
      event('customer.subscription.updated', {
        id: 'sub_123',
        customer: 'cus_123',
        items: { data: [{ price: { id: 'price_enterprise' } }] },
      }),
    );
    mockPrisma.subscriptionEvent.findUnique.mockResolvedValue(null);
    mockPrisma.schoolGroup.findFirst.mockResolvedValue({
      id: 'group-1',
      organizations: [
        { id: 'org-1', subscriptionStatus: 'ACTIVE', groupId: 'group-1' },
      ],
    });

    const result = await service.handleStripeEvent(
      Buffer.from('{}'),
      'valid-sig',
    );

    expect(result).toEqual({ received: true });
    expect(mockPrisma.schoolGroup.update).toHaveBeenCalledWith({
      where: { id: 'group-1' },
      data: {
        subscriptionStatus: 'ACTIVE',
        subscriptionTier: 'ENTERPRISE',
        seatLimit: null,
        stripeSubscriptionId: 'sub_123',
      },
    });
  });

  it('recovers a PAST_DUE org and notifies admins on invoice.paid', async () => {
    mockStripe.webhooks.constructEvent.mockReturnValue(
      event('invoice.paid', { customer: 'cus_123' }),
    );
    mockPrisma.subscriptionEvent.findUnique.mockResolvedValue(null);
    mockPrisma.organization.findFirst.mockResolvedValue({
      id: 'org-1',
      stripeCustomerId: 'cus_123',
      subscriptionStatus: 'PAST_DUE',
    });

    const result = await service.handleStripeEvent(
      Buffer.from('{}'),
      'valid-sig',
    );

    expect(mockPrisma.organization.update).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: { subscriptionStatus: 'ACTIVE' },
    });
    expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', role: 'ADMIN' },
    });
    expect(mockNotifications.notifyUser).toHaveBeenCalledTimes(2);
    expect(mockNotifications.notifyUser).toHaveBeenCalledWith(
      'admin-1',
      'PAYMENT_RECOVERED',
      expect.any(String),
      expect.any(String),
    );
    expect(result).toEqual({ received: true });
  });

  it('does not notify admins on invoice.paid when the org was not PAST_DUE', async () => {
    mockStripe.webhooks.constructEvent.mockReturnValue(
      event('invoice.paid', { customer: 'cus_123' }),
    );
    mockPrisma.subscriptionEvent.findUnique.mockResolvedValue(null);
    mockPrisma.organization.findFirst.mockResolvedValue({
      id: 'org-1',
      stripeCustomerId: 'cus_123',
      subscriptionStatus: 'ACTIVE',
    });

    await service.handleStripeEvent(Buffer.from('{}'), 'valid-sig');

    expect(mockNotifications.notifyUser).not.toHaveBeenCalled();
  });

  it('notifies admins with the amount and due date on invoice.payment_failed', async () => {
    mockStripe.webhooks.constructEvent.mockReturnValue(
      event('invoice.payment_failed', {
        customer: 'cus_123',
        amount_due: 29900,
        due_date: 1786000000,
      }),
    );
    mockPrisma.subscriptionEvent.findUnique.mockResolvedValue(null);
    mockPrisma.organization.findFirst.mockResolvedValue({
      id: 'org-1',
      stripeCustomerId: 'cus_123',
      subscriptionStatus: 'ACTIVE',
    });

    const result = await service.handleStripeEvent(
      Buffer.from('{}'),
      'valid-sig',
    );

    expect(mockPrisma.organization.update).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: { subscriptionStatus: 'PAST_DUE' },
    });
    expect(mockNotifications.notifyUser).toHaveBeenCalledWith(
      'admin-1',
      'PAYMENT_FAILED',
      'Subscription payment failed',
      expect.stringContaining('$299.00'),
    );
    expect(result).toEqual({ received: true });
  });

  it('keeps notifying admins even when one notification fails', async () => {
    mockStripe.webhooks.constructEvent.mockReturnValue(
      event('invoice.paid', { customer: 'cus_123' }),
    );
    mockPrisma.subscriptionEvent.findUnique.mockResolvedValue(null);
    mockPrisma.organization.findFirst.mockResolvedValue({
      id: 'org-1',
      stripeCustomerId: 'cus_123',
      subscriptionStatus: 'PAST_DUE',
    });
    mockNotifications.notifyUser.mockRejectedValueOnce(new Error('email down'));

    const result = await service.handleStripeEvent(
      Buffer.from('{}'),
      'valid-sig',
    );

    expect(mockNotifications.notifyUser).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ received: true });
  });
});
