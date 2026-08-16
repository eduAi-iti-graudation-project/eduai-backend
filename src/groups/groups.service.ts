import { Inject, Injectable, HttpStatus } from '@nestjs/common';
import { randomBytes } from 'crypto';
import type { Stripe } from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { STRIPE_CLIENT } from '../billing/stripe-client';
import { getPlan } from '../billing/plan-catalog';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';
import type { User } from '@prisma/client';

const GROUP_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

@Injectable()
export class GroupsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
  ) {}

  private generateJoinCode(): string {
    const bytes = randomBytes(8);
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += GROUP_CODE_ALPHABET[bytes[i] % GROUP_CODE_ALPHABET.length];
    }
    return code;
  }

  private async findGroupedOrg(user: User) {
    const row = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: {
        organization: {
          include: {
            group: {
              include: {
                organizations: {
                  select: {
                    id: true,
                    name: true,
                    joinCode: true,
                    _count: { select: { users: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    const organization = row?.organization;
    if (!organization?.group) {
      throw new ApiError(
        ErrorCode.GROUP_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'Your school is not part of a group yet.',
      );
    }
    return organization;
  }

  async findMine(user: User) {
    const organization = await this.findGroupedOrg(user);
    const group = organization.group!;

    return {
      id: group.id,
      name: group.name,
      joinCode: group.joinCode,
      subscriptionTier: group.subscriptionTier,
      subscriptionStatus: group.subscriptionStatus,
      seatLimit: group.seatLimit,
      schools: group.organizations.map((school) => ({
        id: school.id,
        name: school.name,
        joinCode: school.joinCode,
        seatUsage: school._count.users,
        subscriptionTier: group.subscriptionTier,
      })),
    };
  }

  async insights(user: User) {
    const organization = await this.findGroupedOrg(user);
    const group = organization.group!;

    const schools = await Promise.all(
      group.organizations.map(async (school) => {
        const [students, teachers, activeAlerts, quizAttempts] =
          await Promise.all([
            this.prisma.user.count({
              where: { organizationId: school.id, role: 'STUDENT' },
            }),
            this.prisma.user.count({
              where: { organizationId: school.id, role: 'TEACHER' },
            }),
            this.prisma.alert.count({
              where: {
                status: 'ACTIVE',
                student: { organizationId: school.id },
              },
            }),
            this.prisma.quizAttempt.count({
              where: { student: { organizationId: school.id } },
            }),
          ]);
        return {
          id: school.id,
          name: school.name,
          users: school._count.users,
          students,
          teachers,
          activeAlerts,
          quizAttempts,
        };
      }),
    );

    const totals = schools.reduce(
      (acc, school) => ({
        users: acc.users + school.users,
        students: acc.students + school.students,
        teachers: acc.teachers + school.teachers,
        activeAlerts: acc.activeAlerts + school.activeAlerts,
        quizAttempts: acc.quizAttempts + school.quizAttempts,
      }),
      {
        users: 0,
        students: 0,
        teachers: 0,
        activeAlerts: 0,
        quizAttempts: 0,
      },
    );

    return {
      id: group.id,
      name: group.name,
      schools,
      totals,
    };
  }

  /**
   * WP5: create a group, assign the current org, move its billing home.
   * Groups are Enterprise-only and seat-unlimited, so the org's existing
   * subscription (if any) is upgraded to Enterprise in place; otherwise the
   * frontend must run an Enterprise checkout (requiresCheckout).
   */
  async create(user: User, name: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: user.organizationId! },
    });
    if (!organization) {
      throw new ApiError(
        ErrorCode.ORG_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'Your organization could not be found.',
      );
    }
    if (organization.groupId) {
      throw new ApiError(
        ErrorCode.GROUP_ALREADY_MEMBER,
        HttpStatus.CONFLICT,
        'Your school already belongs to a group.',
      );
    }

    const group = await this.prisma.$transaction(async (tx) => {
      const created = await tx.schoolGroup.create({
        data: {
          name,
          joinCode: this.generateJoinCode(),
          stripeCustomerId: organization.stripeCustomerId,
          stripeSubscriptionId: organization.stripeSubscriptionId,
          subscriptionTier: 'ENTERPRISE',
          subscriptionStatus: organization.subscriptionStatus,
          seatLimit: null,
        },
      });
      await tx.organization.update({
        where: { id: organization.id },
        data: {
          groupId: created.id,
          stripeCustomerId: null,
          stripeSubscriptionId: null,
        },
      });
      return created;
    });

    let requiresCheckout = false;
    let action: 'UPGRADED' | 'CHECKOUT_REQUIRED' | 'OK' = 'OK';

    if (organization.stripeSubscriptionId) {
      const plan = getPlan('enterprise');
      const priceId = plan?.getPriceId();
      if (!plan || !priceId) {
        throw new ApiError(
          ErrorCode.PLAN_NOT_AVAILABLE,
          HttpStatus.BAD_REQUEST,
          'The Enterprise plan is not available for purchase right now.',
        );
      }
      const subscription = await this.stripe.subscriptions.retrieve(
        organization.stripeSubscriptionId,
      );
      const item = subscription.items?.data?.[0];
      if (!item) {
        throw new ApiError(
          ErrorCode.BILLING_NO_ITEMS,
          HttpStatus.BAD_REQUEST,
          'Your subscription cannot be changed right now.',
        );
      }
      await this.stripe.subscriptions.update(subscription.id, {
        items: [{ id: item.id, price: priceId }],
        proration_behavior: 'create_prorations',
      });
      action = 'UPGRADED';
    } else {
      requiresCheckout = true;
      action = 'CHECKOUT_REQUIRED';
    }

    return {
      id: group.id,
      name: group.name,
      joinCode: group.joinCode,
      requiresCheckout,
      action,
      message: requiresCheckout
        ? 'Your school group is ready. Subscribe to Enterprise to activate billing for the whole group.'
        : 'Your school group is ready on the Enterprise plan.',
    };
  }

  /**
   * WP5: join an existing group by its join code. The joining school inherits
   * the group's Enterprise billing; its own subscription (if any) is stopped
   * at the period end to avoid double billing.
   */
  async join(user: User, joinCode: string) {
    const code = joinCode.trim().toUpperCase();
    const group = await this.prisma.schoolGroup.findUnique({
      where: { joinCode: code },
      select: { id: true, name: true },
    });
    if (!group) {
      throw new ApiError(
        ErrorCode.GROUP_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'No school group matches that join code.',
      );
    }

    const organization = await this.prisma.organization.findUnique({
      where: { id: user.organizationId! },
    });
    if (!organization) {
      throw new ApiError(
        ErrorCode.ORG_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'Your organization could not be found.',
      );
    }
    if (organization.groupId) {
      throw new ApiError(
        ErrorCode.GROUP_ALREADY_MEMBER,
        HttpStatus.CONFLICT,
        'Your school already belongs to a group.',
      );
    }

    if (organization.stripeSubscriptionId) {
      try {
        await this.stripe.subscriptions.update(
          organization.stripeSubscriptionId,
          { cancel_at_period_end: true },
        );
      } catch {
        // Ignore cancellation errors; the org's local billing fields are
        // cleared regardless and the group becomes the billing owner.
      }
    }

    await this.prisma.organization.update({
      where: { id: organization.id },
      data: {
        groupId: group.id,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        subscriptionStatus: 'TRIALING',
        subscriptionTier: 'TRIAL',
        seatLimit: null,
      },
    });

    return {
      id: group.id,
      name: group.name,
      message: `Your school is now part of ${group.name}.`,
    };
  }
}
