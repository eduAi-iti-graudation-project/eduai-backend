import { Inject, Injectable, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { STRIPE_CLIENT } from '../billing/stripe-client';
import { NotificationsService } from '../notifications/notifications.service';
import type { SubscriptionStatus, SubscriptionTier } from '@prisma/client';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';
import { ErrorHint } from '../common/errors/hints';

const PLAN_LIMITS: Record<string, number> = {
  basic: 30,
  pro: 100,
  enterprise: 500,
};

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async handleStripeEvent(payload: Buffer, signature: string) {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      throw new ApiError(
        ErrorCode.WEBHOOK_UNCONFIGURED,
        HttpStatus.INTERNAL_SERVER_ERROR,
        'The webhook secret is not configured.',
        {
          hint: ErrorHint.RETRY,
          cause: new Error('STRIPE_WEBHOOK_SECRET is not configured'),
        },
      );
    }

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        payload,
        signature,
        webhookSecret,
      );
    } catch (cause) {
      throw new ApiError(
        ErrorCode.WEBHOOK_INVALID_SIGNATURE,
        HttpStatus.UNAUTHORIZED,
        'Invalid Stripe signature.',
        { cause },
      );
    }

    const existing = await this.prisma.subscriptionEvent.findUnique({
      where: { stripeEventId: event.id },
    });
    if (existing) {
      return { received: true, duplicate: true };
    }

    switch (event.type) {
      case 'checkout.session.completed':
        return this.handleCheckoutCompleted(event);
      case 'customer.subscription.updated':
        return this.handleSubscriptionUpdated(event);
      case 'invoice.paid':
        return this.handleInvoicePaid(event);
      case 'invoice.payment_failed':
        return this.handlePaymentFailed(event);
      case 'customer.subscription.deleted':
        return this.handleSubscriptionDeleted(event);
      default:
        return { received: true, unhandled: event.type };
    }
  }

  private async handleCheckoutCompleted(event: Stripe.Event) {
    const session = event.data.object as Stripe.Checkout.Session;
    const organizationId = session.metadata?.organizationId;
    const planId = session.metadata?.planId;
    if (!organizationId || !planId || !PLAN_LIMITS[planId]) {
      return { received: true, ignored: true };
    }

    const subscriptionId = this.subscriptionId(session.subscription);
    await this.persistAndUpdate(event, organizationId, organizationId, {
      subscriptionStatus: 'ACTIVE',
      subscriptionTier: planId.toUpperCase() as SubscriptionTier,
      seatLimit: PLAN_LIMITS[planId],
      stripeSubscriptionId: subscriptionId ?? undefined,
    });
    return { received: true };
  }

  private async handleSubscriptionUpdated(event: Stripe.Event) {
    const subscription = event.data.object as Stripe.Subscription;
    const customer = this.customerId(subscription.customer);
    const found = customer ? await this.findByCustomer(customer) : null;
    if (!found) return { received: true, ignored: true };
    const { organization, homeId } = found;

    const priceId = subscription.items?.data?.[0]?.price?.id;
    const planId = priceId ? this.planFromPrice(priceId) : null;
    if (!planId) return { received: true, ignored: true };

    await this.persistAndUpdate(event, organization.id, homeId, {
      subscriptionStatus: organization.subscriptionStatus,
      subscriptionTier: planId.toUpperCase() as SubscriptionTier,
      seatLimit: PLAN_LIMITS[planId],
      stripeSubscriptionId: subscription.id,
    });
    return { received: true };
  }

  private async handleInvoicePaid(event: Stripe.Event) {
    const invoice = event.data.object as Stripe.Invoice;
    const customer = this.customerId(invoice.customer);
    const found = customer ? await this.findByCustomer(customer) : null;
    if (!found) return { received: true, ignored: true };
    const { organization, homeId } = found;

    const wasPastDue = organization.subscriptionStatus === 'PAST_DUE';
    await this.persistAndUpdate(event, organization.id, homeId, {
      subscriptionStatus: 'ACTIVE',
    });

    if (wasPastDue) {
      await this.notifyAdmins(
        organization.id,
        'PAYMENT_RECOVERED',
        'Payment recovered',
        'Your organization subscription payment was successful. Access has been restored.',
      );
    }
    return { received: true };
  }

  private async handlePaymentFailed(event: Stripe.Event) {
    const invoice = event.data.object as Stripe.Invoice;
    const customer = this.customerId(invoice.customer);
    const found = customer ? await this.findByCustomer(customer) : null;
    if (!found) return { received: true, ignored: true };
    const { organization, homeId } = found;

    await this.persistAndUpdate(event, organization.id, homeId, {
      subscriptionStatus: 'PAST_DUE',
    });

    const amount = ((invoice.amount_due ?? 0) / 100).toFixed(2);
    const dueDate = invoice.due_date
      ? new Date(invoice.due_date * 1000).toISOString().slice(0, 10)
      : null;
    await this.notifyAdmins(
      organization.id,
      'PAYMENT_FAILED',
      'Subscription payment failed',
      `Your latest payment of $${amount}${
        dueDate ? ` was due ${dueDate}` : ''
      } could not be collected. Please update your payment method to avoid losing access.`,
    );
    return { received: true };
  }

  private async handleSubscriptionDeleted(event: Stripe.Event) {
    const subscription = event.data.object as Stripe.Subscription;
    const customer = this.customerId(subscription.customer);
    const found = customer ? await this.findByCustomer(customer) : null;
    if (!found) return { received: true, ignored: true };
    const { organization, homeId } = found;

    await this.persistAndUpdate(event, organization.id, homeId, {
      subscriptionStatus: 'CANCELED',
    });
    return { received: true };
  }

  private async notifyAdmins(
    organizationId: string,
    type: string,
    title: string,
    body: string,
  ) {
    try {
      const admins = await this.prisma.user.findMany({
        where: { organizationId, role: 'ADMIN' },
      });
      await Promise.all(
        admins.map((admin) =>
          this.notifications.notifyUser(admin.id, type, title, body),
        ),
      );
    } catch (err) {
      this.logger.error(
        `Failed to notify admins of org ${organizationId}`,
        err,
      );
    }
  }

  private customerId(
    customer: Stripe.Invoice['customer'] | Stripe.Subscription['customer'],
  ): string | null {
    return typeof customer === 'string' ? customer : null;
  }

  private subscriptionId(
    subscription: Stripe.Checkout.Session['subscription'],
  ): string | null {
    return typeof subscription === 'string' ? subscription : null;
  }

  private planFromPrice(priceId: string): string | null {
    const prices: Record<string, string> = {
      [process.env.STRIPE_PRICE_BASIC ?? '']: 'basic',
      [process.env.STRIPE_PRICE_PRO ?? '']: 'pro',
      [process.env.STRIPE_PRICE_ENTERPRISE ?? '']: 'enterprise',
    };
    return prices[priceId] ?? null;
  }

  private async findByCustomer(customer: string | null) {
    if (!customer) return Promise.resolve(null);
    // WP5: a SchoolGroup owns billing; resolve the group first, then fall
    // back to a lone organization. The billing representative is the first
    // (creator) organization of the group.
    const group = await this.prisma.schoolGroup.findFirst({
      where: { stripeCustomerId: customer },
      include: {
        organizations: { orderBy: { createdAt: 'asc' }, take: 1 },
      },
    });
    if (group?.organizations[0]) {
      return {
        organization: group.organizations[0] as {
          id: string;
          subscriptionStatus: SubscriptionStatus;
          groupId: string | null;
        },
        homeId: group.id,
      };
    }
    const organization = await this.prisma.organization.findFirst({
      where: { stripeCustomerId: customer },
      select: { id: true, subscriptionStatus: true, groupId: true },
    });
    return organization ? { organization, homeId: organization.id } : null;
  }

  private async persistAndUpdate(
    event: Stripe.Event,
    organizationId: string,
    homeId: string,
    data: {
      subscriptionStatus: SubscriptionStatus;
      subscriptionTier?: SubscriptionTier;
      seatLimit?: number;
      stripeSubscriptionId?: string;
    },
  ) {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.subscriptionEvent.create({
          data: {
            organizationId,
            stripeEventId: event.id,
            type: event.type,
            raw: event as unknown as Prisma.InputJsonValue,
          },
        });
        // WP5: write billing home fields to the SchoolGroup when grouped.
        if (homeId !== organizationId) {
          await tx.schoolGroup.update({
            where: { id: homeId },
            data,
          });
        } else {
          await tx.organization.update({
            where: { id: organizationId },
            data,
          });
        }
      });
    } catch (err) {
      if (
        !(err instanceof Prisma.PrismaClientKnownRequestError) ||
        err.code !== 'P2002'
      ) {
        throw err;
      }
    }
  }
}
