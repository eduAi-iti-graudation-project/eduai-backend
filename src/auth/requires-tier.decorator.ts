import { SetMetadata } from '@nestjs/common';
import type { SubscriptionTier } from '@prisma/client';

export const REQUIRED_TIERS_KEY = 'requiredTiers';

export const RequiresTier = (...tiers: SubscriptionTier[]) =>
  SetMetadata(REQUIRED_TIERS_KEY, tiers);
