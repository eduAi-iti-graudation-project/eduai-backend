import { HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SubscriptionGuard } from './subscription.guard';
import { SKIP_SUBSCRIPTION_KEY } from './skip-subscription.decorator';
import { REQUIRED_TIERS_KEY } from './requires-tier.decorator';
import type {
  Organization,
  SubscriptionStatus,
  SubscriptionTier,
} from '@prisma/client';

describe('SubscriptionGuard', () => {
  let guard: SubscriptionGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new SubscriptionGuard(reflector);
  });

  function org(
    status: SubscriptionStatus,
    createdAt = new Date(),
    subscriptionTier: SubscriptionTier = 'TRIAL',
  ): Organization {
    return {
      id: 'org-1',
      name: 'Demo School',
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      subscriptionTier,
      subscriptionStatus: status,
      seatLimit: 30,
      createdAt,
      trialReminderSentAt: null,
      trialExpiredSentAt: null,
    };
  }

  function contextWith(
    user: { organization?: Organization } | null,
    handler: () => void = () => {},
  ) {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
      getHandler: () => handler,
      getClass: () => ({}),
    } as unknown as Parameters<typeof guard.canActivate>[0];
  }

  function tierContext(
    status: SubscriptionStatus,
    subscriptionTier: SubscriptionTier,
    requiredTiers: SubscriptionTier[],
  ) {
    const handler = () => {};
    Reflect.defineMetadata(REQUIRED_TIERS_KEY, requiredTiers, handler);
    return contextWith(
      { organization: org(status, new Date(), subscriptionTier) },
      handler,
    );
  }

  it('allows ACTIVE organizations', () => {
    expect(
      guard.canActivate(contextWith({ organization: org('ACTIVE') })),
    ).toBe(true);
  });

  it('allows TRIALING organizations inside the 14-day window', () => {
    const createdAt = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    expect(
      guard.canActivate(
        contextWith({ organization: org('TRIALING', createdAt) }),
      ),
    ).toBe(true);
  });

  it('rejects TRIALING organizations past the 14-day window with 402', () => {
    const createdAt = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
    expect(() =>
      guard.canActivate(
        contextWith({ organization: org('TRIALING', createdAt) }),
      ),
    ).toThrow(HttpException);
    try {
      guard.canActivate(
        contextWith({ organization: org('TRIALING', createdAt) }),
      );
    } catch (err) {
      expect((err as HttpException).getStatus()).toBe(402);
    }
  });

  it('rejects PAST_DUE organizations with 402', () => {
    expect(() =>
      guard.canActivate(contextWith({ organization: org('PAST_DUE') })),
    ).toThrow(HttpException);
  });

  it('rejects CANCELED organizations with 402', () => {
    expect(() =>
      guard.canActivate(contextWith({ organization: org('CANCELED') })),
    ).toThrow(HttpException);
  });

  it('allows requests without a user (public routes)', () => {
    expect(guard.canActivate(contextWith(null))).toBe(true);
  });

  it('allows users without an organization', () => {
    expect(guard.canActivate(contextWith({}))).toBe(true);
  });

  it('skips the check when @SkipSubscriptionCheck is set', () => {
    const handler = () => {};
    Reflect.defineMetadata(SKIP_SUBSCRIPTION_KEY, true, handler);
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ user: { organization: org('CANCELED') } }),
      }),
      getHandler: () => handler,
      getClass: () => ({}),
    } as unknown as Parameters<typeof guard.canActivate>[0];

    expect(guard.canActivate(context)).toBe(true);
  });

  describe('tier gating (@RequiresTier)', () => {
    it('rejects ACTIVE Basic orgs on Pro-only features with 403', () => {
      expect(() =>
        guard.canActivate(
          tierContext('ACTIVE', 'BASIC', ['PRO', 'ENTERPRISE']),
        ),
      ).toThrow(HttpException);
      try {
        guard.canActivate(
          tierContext('ACTIVE', 'BASIC', ['PRO', 'ENTERPRISE']),
        );
      } catch (err) {
        expect((err as HttpException).getStatus()).toBe(403);
      }
    });

    it('allows ACTIVE Pro orgs on Pro-only features', () => {
      expect(
        guard.canActivate(tierContext('ACTIVE', 'PRO', ['PRO', 'ENTERPRISE'])),
      ).toBe(true);
    });

    it('rejects ACTIVE Pro orgs on Enterprise-only features with 403', () => {
      expect(() =>
        guard.canActivate(tierContext('ACTIVE', 'PRO', ['ENTERPRISE'])),
      ).toThrow(HttpException);
    });

    it('allows ACTIVE Enterprise orgs on Enterprise-only features', () => {
      expect(
        guard.canActivate(tierContext('ACTIVE', 'ENTERPRISE', ['ENTERPRISE'])),
      ).toBe(true);
    });

    it('allows TRIALING orgs on any feature (full access during trial)', () => {
      expect(
        guard.canActivate(tierContext('TRIALING', 'TRIAL', ['ENTERPRISE'])),
      ).toBe(true);
    });

    it('allows ACTIVE orgs when no tier requirement is set', () => {
      expect(
        guard.canActivate(contextWith({ organization: org('ACTIVE') })),
      ).toBe(true);
    });
  });
});
