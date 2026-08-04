import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { TrialReminderService } from './trial-reminder.service';
import { STRIPE_CLIENT, createStripeClient } from './stripe-client';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [BillingController],
  providers: [
    BillingService,
    TrialReminderService,
    { provide: STRIPE_CLIENT, useFactory: createStripeClient },
  ],
  exports: [BillingService, STRIPE_CLIENT],
})
export class BillingModule {}
