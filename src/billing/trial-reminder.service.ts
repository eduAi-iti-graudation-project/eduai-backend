import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

const TRIAL_DAYS = 14;
const REMINDER_DAYS_BEFORE = 3;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

@Injectable()
export class TrialReminderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TrialReminderService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    if (process.env.TRIAL_REMINDER_ENABLED === 'false') return;
    void this.runSweep();
    this.timer = setInterval(() => void this.runSweep(), SWEEP_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async runSweep(): Promise<{ expiring: number; expired: number }> {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    const [expiringSoon, expired] = await Promise.all([
      this.prisma.organization.findMany({
        where: {
          subscriptionStatus: 'TRIALING',
          trialReminderSentAt: null,
          createdAt: {
            lte: new Date(now - (TRIAL_DAYS - REMINDER_DAYS_BEFORE) * day),
          },
        },
        include: { users: { where: { role: 'ADMIN' }, select: { id: true } } },
      }),
      this.prisma.organization.findMany({
        where: {
          subscriptionStatus: 'TRIALING',
          trialExpiredSentAt: null,
          createdAt: { lt: new Date(now - TRIAL_DAYS * day) },
        },
        include: { users: { where: { role: 'ADMIN' }, select: { id: true } } },
      }),
    ]);

    await Promise.all([
      ...expiringSoon.map((org) =>
        this.remind(
          org,
          'trialReminderSentAt',
          'TRIAL_EXPIRING',
          'Trial ends in 3 days',
          'Your free trial expires in 3 days. Upgrade to keep your organization active.',
        ),
      ),
      ...expired.map((org) =>
        this.remind(
          org,
          'trialExpiredSentAt',
          'TRIAL_EXPIRED',
          'Trial ended',
          'Your free trial has ended. Upgrade to restore access for your organization.',
        ),
      ),
    ]);

    return { expiring: expiringSoon.length, expired: expired.length };
  }

  private async remind(
    org: { id: string; users: { id: string }[] },
    column: 'trialReminderSentAt' | 'trialExpiredSentAt',
    type: string,
    title: string,
    body: string,
  ) {
    try {
      for (const admin of org.users) {
        await this.notifications.notifyUser(admin.id, type, title, body);
      }
    } catch (err) {
      this.logger.error(`Trial reminder failed for org ${org.id}`, err);
    } finally {
      await this.prisma.organization.update({
        where: { id: org.id },
        data: { [column]: new Date() },
      });
    }
  }
}
