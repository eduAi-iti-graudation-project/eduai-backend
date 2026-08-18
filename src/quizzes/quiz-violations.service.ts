import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { Prisma, QuizAttempt } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ReportsService } from '../reports/reports.service';

const ALERT_TYPE = 'QUIZ_VIOLATION';
// How long after a timed quiz's deadline (plus the same grace the submit path
// allows) before an IN_PROGRESS attempt is treated as abandoned.
const GRACE_PERIOD_MS = 2 * 60 * 1000;
// Quizzes without a timeLimit get a fixed window before an attempt is closed.
const DEFAULT_ABANDON_WINDOW_MS = 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 15 * 60 * 1000;

type ViolationRecord = { type: string; occurredAt: string };

function toViolations(value: Prisma.JsonValue | null): ViolationRecord[] {
  if (!Array.isArray(value)) return [];
  return value as ViolationRecord[];
}

type ViolationCounts = { tabSwitch: number; fullscreenExit: number };

@Injectable()
export class QuizViolationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QuizViolationsService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly reports: ReportsService,
  ) {}

  onModuleInit() {
    if (process.env.QUIZ_VIOLATION_SWEEP_ENABLED === 'false') return;
    void this.runSweep().catch((err) =>
      this.logger.error('Initial quiz violation sweep failed', err),
    );
    this.timer = setInterval(() => {
      void this.runSweep().catch((err) =>
        this.logger.error('Quiz violation sweep failed', err),
      );
    }, SWEEP_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Produce the single QUIZ_VIOLATION alert + three-tier report + in-app/email
   * notifications for an attempt with violations. Idempotent per attempt —
   * `violationReportedAt` is claimed atomically so concurrent calls can't
   * double-report. Trigger is plain code, never a prompt.
   */
  async report(attemptId: string, endedBy: 'SUBMIT' | 'ABANDONED' = 'SUBMIT') {
    const attempt = await this.prisma.quizAttempt.findUnique({
      where: { id: attemptId },
      include: { quiz: true, student: true },
    });
    if (!attempt) return false;
    if (attempt.violationReportedAt) return false;
    if (toViolations(attempt.violations).length === 0) return false;

    const claimed = await this.prisma.quizAttempt.updateMany({
      where: { id: attemptId, violationReportedAt: null },
      data: { violationReportedAt: new Date() },
    });
    if (claimed.count === 0) return false;

    const counts = this.countViolations(attempt.violations);

    try {
      const alert = await this.prisma.alert.create({
        data: {
          type: ALERT_TYPE,
          reason: this.buildReason(attempt, counts, endedBy),
          status: 'ACTIVE',
          studentId: attempt.studentId,
        },
      });

      await this.notifyAll(attempt, counts);

      Promise.resolve(this.reports.generate(attempt.studentId, alert.id)).catch(
        (err) =>
          this.logger.error(
            `Failed to generate report for quiz violation alert ${alert.id}`,
            err,
          ),
      );
    } catch (err) {
      this.logger.error(
        `Failed to report violations for attempt ${attemptId}`,
        err,
      );
      throw err;
    }

    return true;
  }

  /**
   * Close IN_PROGRESS attempts that outlived their window (timeLimit + grace,
   * or a fixed window when the quiz has no time limit) and report any that
   * recorded violations. Deterministic sweep, same style as the trial reminder.
   */
  async runSweep(): Promise<number> {
    const now = Date.now();
    const candidates = await this.prisma.quizAttempt.findMany({
      where: { status: 'IN_PROGRESS', violationReportedAt: null },
      include: { quiz: true },
    });

    let reported = 0;
    for (const attempt of candidates) {
      if (attempt.violationReportedAt) continue;
      if (!this.isAbandoned(attempt, now)) continue;
      if (toViolations(attempt.violations).length === 0) continue;

      await this.prisma.quizAttempt.update({
        where: { id: attempt.id },
        data: { status: 'COMPLETED', submittedAt: new Date() },
      });

      if (await this.report(attempt.id, 'ABANDONED')) reported += 1;
    }

    return reported;
  }

  private isAbandoned(
    attempt: QuizAttempt & { quiz: { timeLimit: number | null } },
    now: number,
  ) {
    const elapsed = now - attempt.startedAt.getTime();
    const window =
      attempt.quiz.timeLimit != null
        ? attempt.quiz.timeLimit * 60_000 + GRACE_PERIOD_MS
        : DEFAULT_ABANDON_WINDOW_MS;
    return elapsed > window;
  }

  private countViolations(
    violations: Prisma.JsonValue | null,
  ): ViolationCounts {
    const records = toViolations(violations);
    return {
      tabSwitch: records.filter((v) => v.type === 'TAB_SWITCH').length,
      fullscreenExit: records.filter((v) => v.type === 'FULLSCREEN_EXIT')
        .length,
    };
  }

  private describeCounts(counts: ViolationCounts): string {
    const parts: string[] = [];
    if (counts.tabSwitch > 0)
      parts.push(
        `${counts.tabSwitch} tab switch${counts.tabSwitch === 1 ? '' : 'es'}`,
      );
    if (counts.fullscreenExit > 0)
      parts.push(
        `${counts.fullscreenExit} fullscreen exit${
          counts.fullscreenExit === 1 ? '' : 's'
        }`,
      );
    return parts.join(' and ') || 'anti-cheat activity';
  }

  private buildReason(
    attempt: QuizAttempt & { quiz: { title: string } },
    counts: ViolationCounts,
    endedBy: 'SUBMIT' | 'ABANDONED',
  ): string {
    const ended =
      endedBy === 'ABANDONED'
        ? 'the attempt was abandoned before completion'
        : 'the attempt was submitted without completing every question';
    return `Quiz "${attempt.quiz.title}": ${this.describeCounts(
      counts,
    )} detected. ${ended}.`;
  }

  private async notifyAll(
    attempt: QuizAttempt & {
      quiz: { title: string };
      student: {
        id: string;
        name: string;
        guardianId: string | null;
        organizationId: string | null;
      };
    },
    counts: ViolationCounts,
  ) {
    const { student } = attempt;
    const events = this.describeCounts(counts);

    await this.notifications.notifyUser(
      student.id,
      ALERT_TYPE,
      'Quiz violation recorded',
      `During "${attempt.quiz.title}", leaving the quiz screen was detected (${events}). The attempt was not completed. This has been reported to your teacher, guardian, and school.`,
    );

    if (student.guardianId) {
      await this.notifications.notifyUser(
        student.guardianId,
        ALERT_TYPE,
        `Quiz violation alert for ${student.name}`,
        `During "${attempt.quiz.title}", ${student.name} left the quiz screen (${events}). The attempt was not completed.`,
      );
    }

    const admins = await this.prisma.user.findMany({
      where: student.organizationId
        ? { role: 'ADMIN', organizationId: student.organizationId }
        : { role: 'ADMIN' },
      select: { id: true },
    });
    if (admins.length > 0) {
      await this.notifications.notifyMany(
        admins.map((a) => a.id),
        ALERT_TYPE,
        'Quiz violation reported',
        `Quiz violation: ${student.name} left the quiz screen (${events}) during "${attempt.quiz.title}". The attempt was not completed.`,
      );
    }
  }
}
