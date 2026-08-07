import { SetMetadata } from '@nestjs/common';

export const SKIP_SUBSCRIPTION_KEY = 'skipSubscriptionCheck';

export const SkipSubscriptionCheck = () =>
  SetMetadata(SKIP_SUBSCRIPTION_KEY, true);
