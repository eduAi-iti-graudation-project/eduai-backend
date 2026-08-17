import { Inject, Injectable, HttpStatus } from '@nestjs/common';
import type { Stripe } from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { STRIPE_CLIENT } from './stripe-client';
import { PlanId } from './dto';
import {
  CORE_FEATURES,
  PLANS,
  TRIAL_DAYS,
  featureLabels,
  getPlan,
} from './plan-catalog';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
  ) {}

  private buildCatalog(plans: typeof PLANS) {
    return {
      trial: {
        days: TRIAL_DAYS,
        features: featureLabels(CORE_FEATURES),
      },
      plans: plans.map((plan) => ({
        id: plan.id,
        name: plan.name,
        price: plan.monthlyPriceCents / 100,
        seatLimit: plan.seatLimit,
        description: plan.description,
        features: featureLabels(plan.features),
        available: Boolean(plan.getPriceId()),
      })),
    };
  }

  getPlans() {
    return this.buildCatalog(PLANS);
  }

  /**
   * WP5 rule: a SchoolGroup is billed on the Enterprise plan only. The guard
   * is applied before any Stripe interaction so grouped schools can never
   * purchase or switch to Basic/Pro.
   */
  private assertGroupAllowsPlan(
    organization: { groupId?: string | null },
    planId: PlanId,
  ): void {
    if (organization.groupId && planId !== 'enterprise') {
      throw new ApiError(
        ErrorCode.GROUP_REQUIRES_ENTERPRISE,
        HttpStatus.FORBIDDEN,
        'School groups are billed on the Enterprise plan only.',
      );
    }
  }

  async createCheckoutSession(input: {
    organizationId: string;
    planId: PlanId;
    successUrl: string;
    cancelUrl: string;
  }) {
    const plan = getPlan(input.planId);
    const priceId = plan?.getPriceId();
    if (!plan || !priceId) {
      throw new ApiError(
        ErrorCode.PLAN_NOT_AVAILABLE,
        HttpStatus.BAD_REQUEST,
        'This plan is not available for purchase right now.',
      );
    }

    const organization = await this.prisma.organization.findUnique({
      where: { id: input.organizationId },
      include: { group: true },
    });
    if (!organization) {
      throw new ApiError(
        ErrorCode.ORG_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'Your organization could not be found.',
      );
    }

    this.assertGroupAllowsPlan(organization, input.planId);

    // WP5: billing belongs to the SchoolGroup when the school is grouped.
    const owner = organization.group ?? organization;
    const persistOwnerCustomer = (customerId: string) =>
      organization.groupId
        ? this.prisma.schoolGroup.update({
            where: { id: organization.groupId },
            data: { stripeCustomerId: customerId },
          })
        : this.prisma.organization.update({
            where: { id: organization.id },
            data: { stripeCustomerId: customerId },
          });

    let customerId = owner.stripeCustomerId;
    if (!customerId) {
      const customer = await this.stripe.customers.create({
        name: owner.name,
        metadata: { organizationId: organization.id },
      });
      customerId = customer.id;
      await persistOwnerCustomer(customerId);
    }

    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      metadata: {
        organizationId: organization.id,
        planId: input.planId,
        groupId: organization.groupId ?? null,
      },
    });

    return { url: session.url ?? '' };
  }

  async changePlan(input: {
    organizationId: string;
    planId: PlanId;
    atPeriodEnd: boolean;
  }) {
    const plan = getPlan(input.planId);
    const priceId = plan?.getPriceId();
    if (!plan || !priceId) {
      throw new ApiError(
        ErrorCode.PLAN_NOT_AVAILABLE,
        HttpStatus.BAD_REQUEST,
        'This plan is not available for purchase right now.',
      );
    }

    const organization = await this.prisma.organization.findUnique({
      where: { id: input.organizationId },
      include: { group: true },
    });
    if (!organization) {
      throw new ApiError(
        ErrorCode.ORG_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'Your organization could not be found.',
      );
    }

    this.assertGroupAllowsPlan(organization, input.planId);

    // WP5: billing belongs to the SchoolGroup when the school is grouped.
    const subscriptionId =
      organization.group?.stripeSubscriptionId ??
      organization.stripeSubscriptionId;
    if (!subscriptionId) {
      throw new ApiError(
        ErrorCode.BILLING_NO_SUBSCRIPTION,
        HttpStatus.BAD_REQUEST,
        'Your organization has no active subscription to change.',
      );
    }

    const subscription =
      await this.stripe.subscriptions.retrieve(subscriptionId);
    const item = subscription.items?.data?.[0];
    if (!item) {
      throw new ApiError(
        ErrorCode.BILLING_NO_ITEMS,
        HttpStatus.BAD_REQUEST,
        'Your subscription cannot be changed right now.',
      );
    }

    const updated = await this.stripe.subscriptions.update(subscription.id, {
      items: [{ id: item.id, price: priceId }],
      proration_behavior: input.atPeriodEnd ? 'none' : 'create_prorations',
    });

    return {
      planId: input.planId,
      status: updated.status,
      cancelAtPeriodEnd: updated.cancel_at_period_end,
    };
  }

  async createBillingPortalSession(input: {
    organizationId: string;
    returnUrl: string;
  }) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: input.organizationId },
      include: { group: true },
    });
    if (!organization) {
      throw new ApiError(
        ErrorCode.ORG_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'Your organization could not be found.',
      );
    }

    // WP5: billing belongs to the SchoolGroup when the school is grouped.
    const owner = organization.group ?? organization;
    const persistOwnerCustomer = (customerId: string) =>
      organization.groupId
        ? this.prisma.schoolGroup.update({
            where: { id: organization.groupId },
            data: { stripeCustomerId: customerId },
          })
        : this.prisma.organization.update({
            where: { id: organization.id },
            data: { stripeCustomerId: customerId },
          });

    let customerId = owner.stripeCustomerId;
    if (!customerId) {
      const customer = await this.stripe.customers.create({
        name: owner.name,
        metadata: { organizationId: organization.id },
      });
      customerId = customer.id;
      await persistOwnerCustomer(customerId);
    }

    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: input.returnUrl,
    });

    return { url: session.url ?? '' };
  }

  async getBillingStatus(organizationId: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      include: {
        group: { include: { organizations: { select: { id: true } } } },
      },
    });
    if (!organization) {
      throw new ApiError(
        ErrorCode.ORG_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'Your organization could not be found.',
      );
    }

    // WP5: a grouped school inherits its billing home from the SchoolGroup.
    const owner = organization.group ?? organization;
    const isGroup = Boolean(organization.group);
    const seatUsage = organization.group
      ? organization.group.organizations.length === 0
        ? 0
        : await this.countGroupSeats(organization.group.organizations)
      : await this.prisma.user.count({ where: { organizationId } });

    const plan =
      owner.subscriptionTier === 'TRIAL'
        ? null
        : getPlan(owner.subscriptionTier.toLowerCase());

    return {
      tier: owner.subscriptionTier,
      status: owner.subscriptionStatus,
      // Groups are billed on Enterprise with unlimited seats.
      seatLimit: isGroup ? null : owner.seatLimit,
      seatUsage,
      planId: plan?.id ?? null,
      trialEndsAt: this.trialEndsAt(owner),
      availablePlans: this.buildCatalog(
        isGroup ? PLANS.filter((p) => p.id === 'enterprise') : PLANS,
      ),
    };
  }

  private async countGroupSeats(orgs: { id: string }[]): Promise<number> {
    const ids = orgs.map((org) => org.id);
    return this.prisma.user.count({
      where: { organizationId: { in: ids } },
    });
  }

  private trialEndsAt(owner: {
    subscriptionStatus: string;
    createdAt: Date;
  }): string | null {
    if (owner.subscriptionStatus !== 'TRIALING') return null;
    const end = new Date(owner.createdAt);
    end.setDate(end.getDate() + TRIAL_DAYS);
    return end.toISOString();
  }
}
