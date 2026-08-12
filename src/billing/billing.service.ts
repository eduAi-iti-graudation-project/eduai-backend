import { Inject, Injectable, HttpStatus } from '@nestjs/common';
import type { Stripe } from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { STRIPE_CLIENT } from './stripe-client';
import { PlanId } from './dto';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';

@Injectable()
export class BillingService {
  private readonly planPrices: Record<PlanId, string | undefined> = {
    basic: process.env.STRIPE_PRICE_BASIC,
    pro: process.env.STRIPE_PRICE_PRO,
    enterprise: process.env.STRIPE_PRICE_ENTERPRISE,
  };

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
  ) {}

  async createCheckoutSession(input: {
    organizationId: string;
    planId: PlanId;
    successUrl: string;
    cancelUrl: string;
  }) {
    const priceId = this.planPrices[input.planId];
    if (!priceId) {
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
      metadata: { organizationId: organization.id, planId: input.planId },
    });

    return { url: session.url ?? '' };
  }

  async changePlan(input: {
    organizationId: string;
    planId: PlanId;
    atPeriodEnd: boolean;
  }) {
    const priceId = this.planPrices[input.planId];
    if (!priceId) {
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
}
