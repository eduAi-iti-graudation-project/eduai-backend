import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Organization, SubscriptionTier } from '@prisma/client';
import { SKIP_SUBSCRIPTION_KEY } from './skip-subscription.decorator';
import { REQUIRED_TIERS_KEY } from './requires-tier.decorator';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';
import { ErrorHint } from '../common/errors/hints';

const TRIAL_DAYS = 14;

@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const skip = this.reflector.getAllAndOverride<boolean>(
      SKIP_SUBSCRIPTION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (skip) return true;

    const request = context
      .switchToHttp()
      .getRequest<{ user?: { organization?: Organization } | null }>();
    const organization = request.user?.organization;
    if (!organization) return true;

    const { subscriptionStatus } = organization;
    if (subscriptionStatus === 'ACTIVE') {
      this.enforceTier(context, organization);
      return true;
    }

    if (subscriptionStatus === 'TRIALING') {
      const trialEnd = new Date(organization.createdAt);
      trialEnd.setDate(trialEnd.getDate() + TRIAL_DAYS);
      if (new Date() <= trialEnd) return true;
    }

    throw new ApiError(
      ErrorCode.SUBSCRIPTION_REQUIRED,
      HttpStatus.PAYMENT_REQUIRED,
      'Your organization needs an active subscription to continue using EduAI.',
      { hint: ErrorHint.UPGRADE },
    );
  }

  private enforceTier(
    context: ExecutionContext,
    organization: Organization,
  ): void {
    const requiredTiers = this.reflector.getAllAndOverride<SubscriptionTier[]>(
      REQUIRED_TIERS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredTiers?.length) return;

    if (!requiredTiers.includes(organization.subscriptionTier)) {
      throw new ApiError(
        ErrorCode.TIER_REQUIRED,
        HttpStatus.FORBIDDEN,
        `This feature requires the ${requiredTiers[0].toLowerCase()} plan or higher.`,
        { hint: ErrorHint.UPGRADE },
      );
    }
  }
}
