import { Injectable, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';
import type { User } from '@prisma/client';
import {
  avgPercentage,
  bucketize,
  bucketizePercent,
  bucketizeRates,
  bucketStarts,
  computeDelta,
  type ChartType,
  type Delta,
  type InsightsInterval,
  type SeriesPoint,
} from './insights.util';

export interface AgentInsight {
  title: string;
  summary: string;
  breakdown?: {
    kind: 'alert';
    type: string;
    severity?: string | null;
    headline: string;
    highlights: string[];
    strengths: string[];
    concerns: string[];
    recommendation: string;
  };
}

export interface InsightSection {
  key: string;
  title: string;
  chartType: ChartType;
  series: SeriesPoint[];
  delta?: Delta;
}

export interface InsightsResponse {
  interval: InsightsInterval;
  sections: InsightSection[];
  agentInsights: AgentInsight[];
  unreadNotifications: number;
}

export interface SectionDetailRecord {
  label: string;
  meta?: string;
  value?: number;
  ref?: { kind: 'student' | 'alert' | 'submission'; id: string };
}

export interface SectionDetail {
  sectionKey: string;
  title: string;
  unit: 'count' | 'percent';
  bucket: string;
  value: number;
  totalRecords: number;
  records: SectionDetailRecord[];
}

interface CriterionScoreRow {
  pointsAwarded: number;
  criteria: { maxPoints: number; description: string };
  submission: {
    id: string;
    createdAt: Date;
    student?: { id: string; name: string } | null;
    assignment?: {
      title?: string;
      offering?: {
        course?: { name?: string } | null;
        section?: { name?: string } | null;
      } | null;
    } | null;
  };
}

const TEACHER_SECTION_KEYS = new Set([
  'submissions_volume',
  'confirmed_grades',
  'pending_confirmations',
  'alerts_created',
  'alerts_resolved',
  'attendance_rate',
  'class_average',
  'criterion_average',
  'struggling_students',
]);

const STUDENT_SECTION_KEYS = new Set([
  'grade_trend',
  'attendance_trend',
  'criterion_strengths',
  'help_action_split',
]);

const ADMIN_SECTION_KEYS = new Set([
  'submissions_volume',
  'confirmed_grades',
  'pass_rate_trend',
  'alerts_created',
  'user_growth',
  'teacher_workload',
  'alert_status_split',
]);

const TEACHER_SECTION_TITLES: Record<string, string> = {
  submissions_volume: 'Submissions per week',
  confirmed_grades: 'Grades confirmed per week',
  pending_confirmations: 'Grades awaiting review per week',
  alerts_created: 'Alerts created per week',
  alerts_resolved: 'Alerts resolved per week',
  attendance_rate: 'Attendance rate per week',
  class_average: 'Average score per class',
  criterion_average: 'Average score per criterion',
  struggling_students: 'Homework-helper redirects per student',
};

const STUDENT_SECTION_TITLES: Record<string, string> = {
  grade_trend: 'My grades over time',
  attendance_trend: 'My attendance per week',
  criterion_strengths: 'Strengths by criterion',
  help_action_split: 'Homework-helper outcomes',
};

const ADMIN_SECTION_TITLES: Record<string, string> = {
  submissions_volume: 'Submissions per week (school)',
  confirmed_grades: 'Grades confirmed per week',
  pass_rate_trend: 'Pass rate per week',
  alerts_created: 'Alerts created per week',
  user_growth: 'Students & teachers per bucket',
  teacher_workload: 'Students & pending reviews per teacher',
  alert_status_split: 'Alert status distribution',
};

const TREND_BUCKETS = 24;
const VISIBLE_BUCKETS = 12;
const PASS_RATIO = 0.6;

@Injectable()
export class InsightsService {
  constructor(private readonly prisma: PrismaService) {}

  async getInsights(
    user: User,
    interval: InsightsInterval,
  ): Promise<InsightsResponse> {
    const unreadNotifications = await this.prisma.notification.count({
      where: { userId: user.id, readAt: null },
    });

    switch (user.role) {
      case 'TEACHER': {
        const { sections, agentInsights } = await this.teacherInsights(
          user.id,
          interval,
        );
        return { interval, sections, agentInsights, unreadNotifications };
      }
      case 'STUDENT': {
        const { sections, agentInsights } = await this.studentSections(
          user.id,
          interval,
        );
        return { interval, sections, agentInsights, unreadNotifications };
      }
      case 'GUARDIAN': {
        const { sections, agentInsights } = await this.guardianInsights(
          user.id,
          interval,
        );
        return { interval, sections, agentInsights, unreadNotifications };
      }
      case 'ADMIN': {
        const { sections, agentInsights } = await this.adminInsights(
          interval,
          user.organizationId!,
        );
        return { interval, sections, agentInsights, unreadNotifications };
      }
    }
  }

  async getStudentInsights(
    user: User,
    studentId: string,
    interval: InsightsInterval,
  ): Promise<InsightsResponse> {
    const target = await this.prisma.user.findUnique({
      where: { id: studentId },
    });
    if (!target) {
      throw new ApiError(
        ErrorCode.INSIGHTS_STUDENT_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This student could not be found.',
      );
    }

    switch (user.role) {
      case 'STUDENT':
        if (user.id !== studentId) {
          throw new ApiError(
            ErrorCode.INSIGHTS_FORBIDDEN,
            HttpStatus.FORBIDDEN,
            'You can only view your own insights.',
          );
        }
        break;
      case 'TEACHER': {
        const cls = await this.prisma.courseOffering.findFirst({
          where: {
            teacherId: user.id,
            section: {
              enrollments: { some: { studentId, status: 'APPROVED' } },
            },
          },
          select: { id: true },
        });
        if (!cls) {
          throw new ApiError(
            ErrorCode.INSIGHTS_FORBIDDEN,
            HttpStatus.FORBIDDEN,
            'You can only view insights for students in your classes.',
          );
        }
        break;
      }
      case 'GUARDIAN': {
        const guardian = await this.prisma.user.findFirst({
          where: { id: user.id, wards: { some: { id: studentId } } },
          select: { id: true },
        });
        if (!guardian) {
          throw new ApiError(
            ErrorCode.INSIGHTS_FORBIDDEN,
            HttpStatus.FORBIDDEN,
            'You can only view insights for your linked students.',
          );
        }
        break;
      }
      case 'ADMIN':
        if (target.organizationId !== user.organizationId) {
          throw new ApiError(
            ErrorCode.INSIGHTS_FORBIDDEN,
            HttpStatus.FORBIDDEN,
            'You can only view insights for students in your organization.',
          );
        }
        break;
    }

    const unreadNotifications = await this.prisma.notification.count({
      where: { userId: user.id, readAt: null },
    });
    const { sections, agentInsights } = await this.studentSections(
      studentId,
      interval,
    );
    return { interval, sections, agentInsights, unreadNotifications };
  }

  async getSectionDetail(
    user: User,
    interval: InsightsInterval,
    sectionKey: string,
    bucket: string,
  ): Promise<SectionDetail> {
    switch (user.role) {
      case 'TEACHER':
        return this.teacherSectionDetail(user.id, interval, sectionKey, bucket);
      case 'STUDENT':
        return this.studentSectionDetail(user.id, interval, sectionKey, bucket);
      case 'GUARDIAN':
        return this.guardianSectionDetail(
          user.id,
          interval,
          sectionKey,
          bucket,
        );
      case 'ADMIN':
        return this.adminSectionDetail(
          interval,
          user.organizationId!,
          sectionKey,
          bucket,
        );
    }
  }

  async getStudentSectionDetail(
    user: User,
    studentId: string,
    interval: InsightsInterval,
    sectionKey: string,
    bucket: string,
  ): Promise<SectionDetail> {
    const target = await this.prisma.user.findUnique({
      where: { id: studentId },
    });
    if (!target) {
      throw new ApiError(
        ErrorCode.INSIGHTS_STUDENT_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This student could not be found.',
      );
    }

    switch (user.role) {
      case 'STUDENT':
        if (user.id !== studentId) {
          throw new ApiError(
            ErrorCode.INSIGHTS_FORBIDDEN,
            HttpStatus.FORBIDDEN,
            'You can only view your own insights.',
          );
        }
        break;
      case 'TEACHER': {
        const cls = await this.prisma.courseOffering.findFirst({
          where: {
            teacherId: user.id,
            section: {
              enrollments: { some: { studentId, status: 'APPROVED' } },
            },
          },
          select: { id: true },
        });
        if (!cls) {
          throw new ApiError(
            ErrorCode.INSIGHTS_FORBIDDEN,
            HttpStatus.FORBIDDEN,
            'You can only view insights for students in your classes.',
          );
        }
        break;
      }
      case 'GUARDIAN': {
        const guardian = await this.prisma.user.findFirst({
          where: { id: user.id, wards: { some: { id: studentId } } },
          select: { id: true },
        });
        if (!guardian) {
          throw new ApiError(
            ErrorCode.INSIGHTS_FORBIDDEN,
            HttpStatus.FORBIDDEN,
            'You can only view insights for your linked students.',
          );
        }
        break;
      }
      case 'ADMIN':
        if (target.organizationId !== user.organizationId) {
          throw new ApiError(
            ErrorCode.INSIGHTS_FORBIDDEN,
            HttpStatus.FORBIDDEN,
            'You can only view insights for students in your organization.',
          );
        }
        break;
    }

    return this.studentSectionDetail(studentId, interval, sectionKey, bucket);
  }

  // ── Detail helpers ───────────────────────────────────────────────────────

  private sectionNotFound(): never {
    throw new ApiError(
      ErrorCode.INSIGHTS_SECTION_NOT_FOUND,
      HttpStatus.NOT_FOUND,
      'This insight chart could not be found.',
    );
  }

  private bucketRange(
    bucket: string,
    interval: InsightsInterval,
  ): { start: Date; end: Date } | null {
    const parts = bucket.split('-');
    if (parts.length !== 3) return null;
    const start = new Date(
      Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])),
    );
    if (Number.isNaN(start.getTime())) return null;
    const end = new Date(start);
    if (interval === 'week') {
      end.setUTCDate(end.getUTCDate() + 7);
    } else {
      end.setUTCMonth(end.getUTCMonth() + 1);
    }
    return { start, end };
  }

  private inBucket(
    when: Date,
    range: { start: Date; end: Date } | null,
  ): boolean {
    return !!range && when >= range.start && when < range.end;
  }

  private avgRecordPct(records: SectionDetailRecord[]): number {
    const values = records
      .map((r) => r.value)
      .filter((v): v is number => typeof v === 'number');
    if (values.length === 0) return 0;
    return (
      Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
    );
  }

  private buildDetail(
    sectionKey: string,
    title: string,
    unit: 'count' | 'percent',
    bucket: string,
    records: SectionDetailRecord[],
  ): SectionDetail {
    return {
      sectionKey,
      title,
      unit,
      bucket,
      value: unit === 'count' ? records.length : this.avgRecordPct(records),
      totalRecords: records.length,
      records,
    };
  }

  private trendDetail(
    sectionKey: string,
    title: string,
    unit: 'count' | 'percent',
    rows: { when: Date; record: SectionDetailRecord }[],
    interval: InsightsInterval,
    bucket: string,
  ): SectionDetail {
    const range = this.bucketRange(bucket, interval);
    const records = rows
      .filter((r) => this.inBucket(r.when, range))
      .map((r) => r.record);
    return this.buildDetail(sectionKey, title, unit, bucket, records);
  }

  private formatDate(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  private criterionDetail(
    sectionKey: string,
    title: string,
    confirmedAll: CriterionScoreRow[],
    bucket: string,
    labelFn: (s: CriterionScoreRow) => string,
    metaFn: (s: CriterionScoreRow) => string | undefined,
  ): SectionDetail {
    const grouped = new Map<string, CriterionScoreRow[]>();
    for (const s of confirmedAll) {
      const name = s.criteria.description;
      const arr = grouped.get(name) ?? [];
      arr.push(s);
      grouped.set(name, arr);
    }
    const selected = grouped.get(bucket) ?? [];
    const records: SectionDetailRecord[] = selected.map((s) => ({
      label: labelFn(s),
      meta: metaFn(s),
      value: this.ratioToPercent(s.pointsAwarded, s.criteria.maxPoints),
      ref: s.submission.student
        ? { kind: 'student', id: s.submission.student.id }
        : undefined,
    }));
    return this.buildDetail(sectionKey, title, 'percent', bucket, records);
  }

  private async teacherSectionDetail(
    teacherId: string,
    interval: InsightsInterval,
    sectionKey: string,
    bucket: string,
  ): Promise<SectionDetail> {
    if (!TEACHER_SECTION_KEYS.has(sectionKey)) {
      this.sectionNotFound();
    }
    const [
      submissions,
      pendingScores,
      confirmedTrend,
      confirmedAll,
      alertsCreated,
      alertsResolved,
      attendance,
      redirects,
    ] = await this.fetchTeacherRows(teacherId, interval);
    const title = TEACHER_SECTION_TITLES[sectionKey];

    switch (sectionKey) {
      case 'submissions_volume':
        return this.trendDetail(
          sectionKey,
          title,
          'count',
          submissions.map((s) => ({
            when: s.createdAt,
            record: {
              label: s.student?.name ?? 'Submission',
              meta: `${s.assignment?.title ?? 'Assignment'}${
                s.assignment?.offering?.course?.name
                  ? ` · ${s.assignment.offering.course.name}`
                  : ''
              }`,
              ref: { kind: 'submission', id: s.id },
            },
          })),
          interval,
          bucket,
        );
      case 'confirmed_grades':
        return this.trendDetail(
          sectionKey,
          title,
          'percent',
          confirmedTrend.map((s) => ({
            when: s.createdAt,
            record: {
              label: s.submission?.student?.name ?? 'Student',
              meta: s.submission?.assignment?.title ?? 'Assignment',
              value: this.ratioToPercent(s.pointsAwarded, s.criteria.maxPoints),
              ref: s.submission?.student
                ? { kind: 'student', id: s.submission.student.id }
                : undefined,
            },
          })),
          interval,
          bucket,
        );
      case 'pending_confirmations':
        return this.trendDetail(
          sectionKey,
          title,
          'count',
          pendingScores.map((s) => ({
            when: s.createdAt,
            record: {
              label: s.submission?.student?.name ?? 'Student',
              meta: s.submission?.assignment?.title ?? 'Assignment',
            },
          })),
          interval,
          bucket,
        );
      case 'alerts_created':
        return this.trendDetail(
          sectionKey,
          title,
          'count',
          alertsCreated.map((a) => ({
            when: a.createdAt,
            record: {
              label: a.student?.name ?? 'Student',
              meta: a.type,
              ref: { kind: 'alert', id: a.id },
            },
          })),
          interval,
          bucket,
        );
      case 'alerts_resolved':
        return this.trendDetail(
          sectionKey,
          title,
          'count',
          alertsResolved.map((a) => ({
            when: a.updatedAt,
            record: {
              label: a.student?.name ?? 'Student',
              meta: `${a.type} · ${a.status}`,
              ref: { kind: 'alert', id: a.id },
            },
          })),
          interval,
          bucket,
        );
      case 'attendance_rate':
        return this.trendDetail(
          sectionKey,
          title,
          'percent',
          attendance.map((a) => ({
            when: a.date,
            record: {
              label: a.student?.name ?? 'Student',
              meta: a.status,
              value: a.status === 'PRESENT' ? 100 : 0,
            },
          })),
          interval,
          bucket,
        );
      case 'class_average':
        return this.criterionDetail(
          sectionKey,
          title,
          confirmedAll,
          bucket,
          (s) =>
            s.submission.assignment?.offering?.course?.name ??
            s.submission.assignment?.offering?.section?.name ??
            'Class',
          (s) =>
            `${s.submission.assignment?.title ?? 'Assignment'}${
              s.submission.assignment?.offering?.course?.name
                ? ` · ${s.submission.assignment.offering.course.name}`
                : ''
            }`,
        );
      case 'criterion_average':
        return this.criterionDetail(
          sectionKey,
          title,
          confirmedAll,
          bucket,
          (s) => s.submission.student?.name ?? 'Student',
          (s) => s.submission.assignment?.title ?? 'Assignment',
        );
      case 'struggling_students': {
        const grouped = new Map<string, (typeof redirects)[number][]>();
        for (const r of redirects) {
          const name = r.student?.name ?? 'Student';
          const arr = grouped.get(name) ?? [];
          arr.push(r);
          grouped.set(name, arr);
        }
        const selected = grouped.get(bucket) ?? [];
        const records: SectionDetailRecord[] = selected.map((r) => ({
          label: r.question?.trim() ? r.question : 'Asked the homework helper',
          meta: this.formatDate(r.createdAt),
        }));
        return this.buildDetail(sectionKey, title, 'count', bucket, records);
      }
      default:
        this.sectionNotFound();
    }
  }

  private async studentSectionDetail(
    studentId: string,
    interval: InsightsInterval,
    sectionKey: string,
    bucket: string,
  ): Promise<SectionDetail> {
    if (!STUDENT_SECTION_KEYS.has(sectionKey)) {
      this.sectionNotFound();
    }
    const [confirmedAll, attendance, interactions] =
      await this.fetchStudentRows(studentId, interval);
    const title = STUDENT_SECTION_TITLES[sectionKey];

    switch (sectionKey) {
      case 'grade_trend':
        return this.trendDetail(
          sectionKey,
          title,
          'percent',
          confirmedAll.map((s) => ({
            when: s.submission.createdAt,
            record: {
              label: s.submission.assignment?.title ?? 'Assignment',
              meta: s.submission.assignment?.offering?.course?.name,
              value: this.ratioToPercent(s.pointsAwarded, s.criteria.maxPoints),
            },
          })),
          interval,
          bucket,
        );
      case 'attendance_trend':
        return this.trendDetail(
          sectionKey,
          title,
          'percent',
          attendance.map((a) => ({
            when: a.date,
            record: {
              label: this.formatDate(a.date),
              meta: a.status,
              value: a.status === 'PRESENT' ? 100 : 0,
            },
          })),
          interval,
          bucket,
        );
      case 'criterion_strengths':
        return this.criterionDetail(
          sectionKey,
          title,
          confirmedAll,
          bucket,
          (s) => s.submission.assignment?.title ?? 'Assignment',
          (s) => this.formatDate(s.submission.createdAt),
        );
      case 'help_action_split': {
        const grouped = new Map<string, (typeof interactions)[number][]>();
        for (const i of interactions) {
          const arr = grouped.get(i.action) ?? [];
          arr.push(i);
          grouped.set(i.action, arr);
        }
        const selected = grouped.get(bucket) ?? [];
        const records: SectionDetailRecord[] = selected.map((i) => ({
          label: i.question?.trim() ? i.question : i.action,
          meta: this.formatDate(i.createdAt),
        }));
        return this.buildDetail(sectionKey, title, 'count', bucket, records);
      }
      default:
        this.sectionNotFound();
    }
  }

  private async guardianSectionDetail(
    guardianId: string,
    interval: InsightsInterval,
    sectionKey: string,
    bucket: string,
  ): Promise<SectionDetail> {
    const match = /^child_([0-9a-fA-F-]{36})_(grades|attendance|alerts)$/.exec(
      sectionKey,
    );
    if (!match) {
      this.sectionNotFound();
    }
    const wardId = match[1];
    const kind = match[2];

    const guardian = await this.prisma.user.findFirst({
      where: { id: guardianId, wards: { some: { id: wardId } } },
      select: { id: true },
    });
    if (!guardian) {
      throw new ApiError(
        ErrorCode.INSIGHTS_FORBIDDEN,
        HttpStatus.FORBIDDEN,
        'You can only view insights for your linked students.',
      );
    }

    const ward = await this.prisma.user.findUnique({
      where: { id: wardId },
      select: { name: true },
    });
    const wardName = ward?.name ?? 'Student';
    const [confirmed, attendance, alerts] = await this.fetchWardRows(
      wardId,
      interval,
    );

    if (kind === 'grades') {
      return this.trendDetail(
        sectionKey,
        `${wardName} grades over time`,
        'percent',
        confirmed.map((s) => ({
          when: s.submission.createdAt,
          record: {
            label: s.submission.assignment?.title ?? 'Assignment',
            meta: s.submission.assignment?.offering?.course?.name,
            value: this.ratioToPercent(s.pointsAwarded, s.criteria.maxPoints),
          },
        })),
        interval,
        bucket,
      );
    }
    if (kind === 'attendance') {
      return this.trendDetail(
        sectionKey,
        `${wardName} attendance per week`,
        'percent',
        attendance.map((a) => ({
          when: a.date,
          record: {
            label: this.formatDate(a.date),
            meta: a.status,
            value: a.status === 'PRESENT' ? 100 : 0,
          },
        })),
        interval,
        bucket,
      );
    }
    return this.trendDetail(
      sectionKey,
      `${wardName} alerts created per week`,
      'count',
      alerts.map((a) => ({
        when: a.createdAt,
        record: {
          label: a.type,
          meta: a.reason,
          ref: { kind: 'alert', id: a.id },
        },
      })),
      interval,
      bucket,
    );
  }

  private async adminSectionDetail(
    interval: InsightsInterval,
    organizationId: string,
    sectionKey: string,
    bucket: string,
  ): Promise<SectionDetail> {
    if (!ADMIN_SECTION_KEYS.has(sectionKey)) {
      this.sectionNotFound();
    }
    const [
      submissions,
      ,
      allConfirmed,
      alertsCreated,
      allAlerts,
      users,
      teachers,
    ] = await this.fetchAdminRows(organizationId, interval);
    const title = ADMIN_SECTION_TITLES[sectionKey];

    switch (sectionKey) {
      case 'submissions_volume':
        return this.trendDetail(
          sectionKey,
          title,
          'count',
          submissions.map((s) => ({
            when: s.createdAt,
            record: {
              label: s.student?.name ?? 'Submission',
              meta: `${s.assignment?.title ?? 'Assignment'}${
                s.assignment?.offering?.course?.name
                  ? ` · ${s.assignment.offering.course.name}`
                  : ''
              }`,
              ref: { kind: 'submission', id: s.id },
            },
          })),
          interval,
          bucket,
        );
      case 'confirmed_grades':
      case 'pass_rate_trend':
        return this.trendDetail(
          sectionKey,
          title,
          'percent',
          allConfirmed.map((s) => ({
            when: s.createdAt,
            record: {
              label: s.submission?.student?.name ?? 'Student',
              meta: `${s.submission?.assignment?.title ?? 'Assignment'}${
                s.submission?.assignment?.offering?.course?.name
                  ? ` · ${s.submission.assignment.offering.course.name}`
                  : ''
              }`,
              value: this.ratioToPercent(s.pointsAwarded, s.criteria.maxPoints),
              ref: s.submission?.student
                ? { kind: 'student', id: s.submission.student.id }
                : undefined,
            },
          })),
          interval,
          bucket,
        );
      case 'alerts_created':
        return this.trendDetail(
          sectionKey,
          title,
          'count',
          alertsCreated.map((a) => ({
            when: a.createdAt,
            record: {
              label: a.student?.name ?? 'Student',
              meta: a.type,
              ref: { kind: 'alert', id: a.id },
            },
          })),
          interval,
          bucket,
        );
      case 'user_growth':
        return this.trendDetail(
          sectionKey,
          title,
          'count',
          users.map((u) => ({
            when: u.createdAt,
            record: {
              label: u.name,
              meta: u.role === 'TEACHER' ? 'Teacher' : 'Student',
            },
          })),
          interval,
          bucket,
        );
      case 'teacher_workload': {
        const teacher = teachers.find((t) => t.name === bucket);
        if (!teacher) {
          return this.buildDetail(sectionKey, title, 'count', bucket, []);
        }
        const submissionsOf = teacher.teacherOfferings
          .flatMap((o) => o.assignments)
          .flatMap((a) => a.submissions);
        const pending = submissionsOf
          .flatMap((s) => s.scores)
          .filter((sc) => !sc.isConfirmed).length;
        const students = teacher.teacherOfferings.reduce(
          (sum, o) => sum + o.section.enrollments.length,
          0,
        );
        const records: SectionDetailRecord[] = [];
        for (const sub of submissionsOf) {
          const pendingCount = sub.scores.filter(
            (sc) => !sc.isConfirmed,
          ).length;
          if (pendingCount > 0) {
            records.push({
              label: sub.student?.name ?? 'Student',
              meta: `Awaiting review${
                pendingCount > 1 ? ` (${pendingCount} criteria)` : ''
              }`,
            });
          }
        }
        if (students > 0) {
          records.push({
            label: 'Enrolled students',
            meta: `${students} across their classes`,
          });
        }
        if (records.length === 0) {
          records.push({
            label: 'All caught up',
            meta: 'No reviews awaiting confirmation',
          });
        }
        const detail = this.buildDetail(
          sectionKey,
          title,
          'count',
          bucket,
          records,
        );
        detail.value = pending + students;
        return detail;
      }
      case 'alert_status_split': {
        const grouped = new Map<string, (typeof allAlerts)[number][]>();
        for (const a of allAlerts) {
          const arr = grouped.get(a.status) ?? [];
          arr.push(a);
          grouped.set(a.status, arr);
        }
        const selected = grouped.get(bucket) ?? [];
        const records: SectionDetailRecord[] = selected.map((a) => ({
          label: a.student?.name ?? 'Student',
          meta: `${a.type}${
            a.createdAt ? ` · ${this.formatDate(a.createdAt)}` : ''
          }`,
          ref: { kind: 'alert', id: a.id },
        }));
        return this.buildDetail(sectionKey, title, 'count', bucket, records);
      }
      default:
        this.sectionNotFound();
    }
  }

  // ── TEACHER ──────────────────────────────────────────────────────────────

  private async fetchTeacherRows(
    teacherId: string,
    interval: InsightsInterval,
  ) {
    const since = bucketStarts(interval, TREND_BUCKETS)[0];
    const studentScope = {
      student: {
        enrollments: {
          some: { section: { offerings: { some: { teacherId } } } },
        },
      },
    };

    return Promise.all([
      this.prisma.submission.findMany({
        where: {
          assignment: { offering: { teacherId } },
          createdAt: { gte: since },
        },
        select: {
          id: true,
          createdAt: true,
          student: { select: { id: true, name: true } },
          assignment: {
            select: {
              title: true,
              offering: { select: { course: { select: { name: true } } } },
            },
          },
        },
      }),
      this.prisma.gradingScore.findMany({
        where: {
          isConfirmed: false,
          submission: { assignment: { offering: { teacherId } } },
          createdAt: { gte: since },
        },
        select: {
          id: true,
          createdAt: true,
          submission: {
            select: {
              student: { select: { id: true, name: true } },
              assignment: { select: { title: true } },
            },
          },
        },
      }),
      this.prisma.gradingScore.findMany({
        where: {
          isConfirmed: true,
          submission: { assignment: { offering: { teacherId } } },
          createdAt: { gte: since },
        },
        select: {
          id: true,
          createdAt: true,
          pointsAwarded: true,
          criteria: { select: { maxPoints: true } },
          submission: {
            select: {
              student: { select: { id: true, name: true } },
              assignment: { select: { title: true } },
            },
          },
        },
      }),
      this.prisma.gradingScore.findMany({
        where: {
          isConfirmed: true,
          submission: { assignment: { offering: { teacherId } } },
        },
        include: {
          criteria: { select: { maxPoints: true, description: true } },
          submission: {
            select: {
              id: true,
              createdAt: true,
              student: { select: { id: true, name: true } },
              assignment: {
                select: {
                  title: true,
                  offering: {
                    select: {
                      course: { select: { name: true } },
                      section: { select: { name: true } },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      this.prisma.alert.findMany({
        where: { createdAt: { gte: since }, ...studentScope },
        select: {
          id: true,
          createdAt: true,
          type: true,
          reason: true,
          student: { select: { id: true, name: true } },
        },
      }),
      this.prisma.alert.findMany({
        where: {
          updatedAt: { gte: since },
          status: { in: ['RESOLVED', 'DISMISSED'] },
          ...studentScope,
        },
        select: {
          id: true,
          updatedAt: true,
          type: true,
          status: true,
          student: { select: { id: true, name: true } },
        },
      }),
      this.prisma.attendance.findMany({
        where: {
          date: { gte: since },
          section: { offerings: { some: { teacherId } } },
        },
        select: {
          id: true,
          date: true,
          status: true,
          student: { select: { id: true, name: true } },
        },
      }),
      this.prisma.homeworkHelpInteraction.findMany({
        where: { action: 'REDIRECT_TEACHER', ...studentScope },
        include: { student: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.studentAnalysis.findMany({
        where: { ...studentScope },
        include: { student: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.studentReport.findMany({
        where: { ...studentScope },
        include: { student: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
  }

  private async teacherInsights(teacherId: string, interval: InsightsInterval) {
    const [
      submissions,
      pendingScores,
      confirmedTrend,
      confirmedAll,
      alertsCreated,
      alertsResolved,
      attendance,
      redirects,
      analyses,
      reports,
    ] = await this.fetchTeacherRows(teacherId, interval);

    const sections: InsightSection[] = [
      this.countTrend(
        'submissions_volume',
        'Submissions per week',
        'area',
        submissions,
        interval,
      ),
      this.countTrend(
        'confirmed_grades',
        'Grades confirmed per week',
        'line',
        confirmedTrend,
        interval,
      ),
      this.countTrend(
        'pending_confirmations',
        'Grades awaiting review per week',
        'line',
        pendingScores,
        interval,
      ),
      this.countTrend(
        'alerts_created',
        'Alerts created per week',
        'area',
        alertsCreated,
        interval,
      ),
      this.countTrend(
        'alerts_resolved',
        'Alerts resolved per week',
        'area',
        alertsResolved.map((a) => ({ createdAt: a.updatedAt })),
        interval,
      ),
      this.rateTrend(
        'attendance_rate',
        'Attendance rate per week',
        attendance,
        interval,
      ),
      this.classAverageBar(confirmedAll),
      this.criterionAverageRadar(confirmedAll),
      this.strugglingStudentsBar(redirects),
    ];

    const agentInsights = this.teacherAgentInsights(
      analyses,
      reports,
      redirects,
    );

    return { sections, agentInsights };
  }

  private teacherAgentInsights(
    analyses: {
      student: { id: string; name: string };
      teacherContent: unknown;
      createdAt: Date;
    }[],
    reports: {
      student: { id: string; name: string };
      teacherSection: unknown;
      createdAt: Date;
    }[],
    redirects: {
      student: { id: string; name: string };
      question: string;
      createdAt: Date;
    }[],
  ): AgentInsight[] {
    const insights: AgentInsight[] = [];

    const latestByStudent = new Map<string, (typeof analyses)[number]>();
    for (const a of analyses) {
      const existing = latestByStudent.get(a.student.id);
      if (!existing || a.createdAt > existing.createdAt) {
        latestByStudent.set(a.student.id, a);
      }
    }
    for (const a of latestByStudent.values()) {
      insights.push({
        title: `${a.student.name} — flagged`,
        summary: this.summarizeJson(a.teacherContent, 'Student flagged'),
      });
    }

    const latestReportByStudent = new Map<string, (typeof reports)[number]>();
    for (const r of reports) {
      const existing = latestReportByStudent.get(r.student.id);
      if (!existing || r.createdAt > existing.createdAt) {
        latestReportByStudent.set(r.student.id, r);
      }
    }
    for (const r of latestReportByStudent.values()) {
      insights.push({
        title: `${r.student.name} — report`,
        summary: this.reportSectionSummary(r.teacherSection),
      });
    }

    for (const r of redirects.slice(0, 5)) {
      insights.push({
        title: `${r.student.name} asked for help`,
        summary: r.question,
      });
    }

    return insights;
  }

  // ── STUDENT (also used by the drill-down) ───────────────────────────────

  private async fetchStudentRows(
    studentId: string,
    interval: InsightsInterval,
  ) {
    const since = bucketStarts(interval, TREND_BUCKETS)[0];

    return Promise.all([
      this.prisma.gradingScore.findMany({
        where: { isConfirmed: true, submission: { studentId } },
        include: {
          criteria: { select: { maxPoints: true, description: true } },
          submission: {
            select: {
              id: true,
              createdAt: true,
              assignment: {
                select: {
                  title: true,
                  offering: { select: { course: { select: { name: true } } } },
                },
              },
            },
          },
        },
      }),
      this.prisma.attendance.findMany({
        where: { studentId, date: { gte: since } },
        select: { id: true, date: true, status: true },
      }),
      this.prisma.homeworkHelpInteraction.findMany({
        where: { studentId },
        select: { id: true, action: true, question: true, createdAt: true },
      }),
      this.prisma.alert.findMany({
        where: { studentId, status: 'ACTIVE' },
        select: {
          id: true,
          type: true,
          reason: true,
          analyses: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { diagnosis: true },
          },
        },
      }),
      this.prisma.studentReport.findMany({
        where: { studentId },
        select: { teacherSection: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
      }),
    ]);
  }

  private async studentSections(studentId: string, interval: InsightsInterval) {
    const [confirmedAll, attendance, interactions, activeAlerts, latestReport] =
      await this.fetchStudentRows(studentId, interval);

    const sections: InsightSection[] = [
      this.percentTrend(
        'grade_trend',
        'My grades over time',
        confirmedAll.map((s) => ({
          createdAt: s.submission.createdAt,
          pct: this.ratioToPercent(s.pointsAwarded, s.criteria.maxPoints),
        })),
        interval,
      ),
      this.rateTrend(
        'attendance_trend',
        'My attendance per week',
        attendance,
        interval,
      ),
      this.criterionStrengthsRadar(confirmedAll),
      this.helpActionDonut(interactions),
    ];

    const agentInsights: AgentInsight[] = [];
    for (const a of activeAlerts) {
      const diagnosis = (a.analyses[0]?.diagnosis ?? {}) as {
        severity?: string | null;
        brief?: {
          headline?: string;
          highlights?: string[];
          strengths?: string[];
          concerns?: string[];
          recommendation?: string;
        } | null;
      };
      const brief = diagnosis.brief;
      agentInsights.push({
        title: `Alert: ${a.type}`,
        summary: a.reason,
        breakdown:
          brief && (brief.headline || brief.highlights?.length)
            ? {
                kind: 'alert',
                type: a.type,
                severity: diagnosis.severity ?? null,
                headline: brief.headline ?? '',
                highlights: brief.highlights ?? [],
                strengths: brief.strengths ?? [],
                concerns: brief.concerns ?? [],
                recommendation: brief.recommendation ?? '',
              }
            : undefined,
      });
    }
    if (latestReport[0]) {
      agentInsights.push({
        title: 'Latest report',
        summary: this.reportSectionSummary(latestReport[0].teacherSection),
      });
    }

    return { sections, agentInsights };
  }

  // ── GUARDIAN ─────────────────────────────────────────────────────────────

  private async fetchWardRows(wardId: string, interval: InsightsInterval) {
    const since = bucketStarts(interval, TREND_BUCKETS)[0];

    return Promise.all([
      this.prisma.gradingScore.findMany({
        where: { isConfirmed: true, submission: { studentId: wardId } },
        include: {
          criteria: { select: { maxPoints: true } },
          submission: {
            select: {
              id: true,
              createdAt: true,
              assignment: {
                select: {
                  title: true,
                  offering: { select: { course: { select: { name: true } } } },
                },
              },
            },
          },
        },
      }),
      this.prisma.attendance.findMany({
        where: { studentId: wardId, date: { gte: since } },
        select: { id: true, date: true, status: true },
      }),
      this.prisma.alert.findMany({
        where: { studentId: wardId, createdAt: { gte: since } },
        select: { id: true, createdAt: true, type: true, reason: true },
      }),
      this.prisma.studentReport.findMany({
        where: { studentId: wardId },
        select: { parentSection: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
      }),
      this.prisma.studentAnalysis.findMany({
        where: { studentId: wardId },
        select: { guardianContent: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
      }),
    ]);
  }

  private async guardianInsights(
    guardianId: string,
    interval: InsightsInterval,
  ) {
    const guardian = await this.prisma.user.findUnique({
      where: { id: guardianId },
      include: { wards: { select: { id: true, name: true } } },
    });
    if (!guardian) return { sections: [], agentInsights: [] };

    const sections: InsightSection[] = [];
    const agentInsights: AgentInsight[] = [];

    for (const ward of guardian.wards) {
      const [confirmed, attendance, alerts, latestReport, latestAnalysis] =
        await this.fetchWardRows(ward.id, interval);

      sections.push(
        this.percentTrend(
          `child_${ward.id}_grades`,
          `${ward.name} grades over time`,
          confirmed.map((s) => ({
            createdAt: s.submission.createdAt,
            pct: this.ratioToPercent(s.pointsAwarded, s.criteria.maxPoints),
          })),
          interval,
        ),
        this.rateTrend(
          `child_${ward.id}_attendance`,
          `${ward.name} attendance per week`,
          attendance,
          interval,
        ),
        this.countTrend(
          `child_${ward.id}_alerts`,
          `${ward.name} alerts created per week`,
          'area',
          alerts,
          interval,
        ),
      );

      if (latestReport[0]) {
        agentInsights.push({
          title: `${ward.name} — report`,
          summary: this.reportSectionSummary(latestReport[0].parentSection),
        });
      }
      if (latestAnalysis[0]) {
        agentInsights.push({
          title: `${ward.name} — analysis`,
          summary: this.summarizeJson(
            latestAnalysis[0].guardianContent,
            'Guardian analysis',
          ),
        });
      }
    }

    return { sections, agentInsights };
  }

  // ── ADMIN ────────────────────────────────────────────────────────────────

  private async fetchAdminRows(
    organizationId: string,
    interval: InsightsInterval,
  ) {
    const since = bucketStarts(interval, TREND_BUCKETS)[0];

    return Promise.all([
      this.prisma.submission.findMany({
        where: {
          createdAt: { gte: since },
          assignment: { offering: { organizationId } },
        },
        select: {
          id: true,
          createdAt: true,
          student: { select: { id: true, name: true } },
          assignment: {
            select: {
              title: true,
              offering: { select: { course: { select: { name: true } } } },
            },
          },
        },
      }),
      this.prisma.gradingScore.findMany({
        where: {
          isConfirmed: true,
          createdAt: { gte: since },
          submission: { assignment: { offering: { organizationId } } },
        },
        select: {
          id: true,
          createdAt: true,
          pointsAwarded: true,
          criteria: { select: { maxPoints: true } },
          submission: {
            select: {
              student: { select: { id: true, name: true } },
              assignment: {
                select: {
                  title: true,
                  offering: { select: { course: { select: { name: true } } } },
                },
              },
            },
          },
        },
      }),
      this.prisma.gradingScore.findMany({
        where: {
          isConfirmed: true,
          submission: { assignment: { offering: { organizationId } } },
        },
        select: {
          id: true,
          createdAt: true,
          pointsAwarded: true,
          criteria: { select: { maxPoints: true } },
          submission: {
            select: {
              id: true,
              student: { select: { id: true, name: true } },
              assignment: {
                select: {
                  title: true,
                  offering: { select: { course: { select: { name: true } } } },
                },
              },
            },
          },
        },
      }),
      this.prisma.alert.findMany({
        where: {
          createdAt: { gte: since },
          student: { organizationId },
        },
        select: {
          id: true,
          createdAt: true,
          type: true,
          reason: true,
          student: { select: { id: true, name: true } },
        },
      }),
      this.prisma.alert.findMany({
        where: { student: { organizationId } },
        select: {
          id: true,
          status: true,
          type: true,
          createdAt: true,
          student: { select: { id: true, name: true } },
        },
      }),
      this.prisma.user.findMany({
        where: {
          role: { in: ['STUDENT', 'TEACHER'] },
          organizationId,
          createdAt: { gte: since },
        },
        select: { id: true, createdAt: true, name: true, role: true },
      }),
      this.prisma.user.findMany({
        where: { role: 'TEACHER', organizationId },
        select: {
          id: true,
          name: true,
          teacherOfferings: {
            select: {
              section: {
                select: {
                  enrollments: {
                    where: { status: 'APPROVED' },
                    select: { id: true },
                  },
                },
              },
              assignments: {
                select: {
                  title: true,
                  submissions: {
                    select: {
                      student: { select: { id: true, name: true } },
                      scores: {
                        select: {
                          isConfirmed: true,
                          pointsAwarded: true,
                          criteria: { select: { maxPoints: true } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      this.prisma.studentReport.findMany({
        where: { student: { organizationId } },
        select: {
          managementSection: true,
          student: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ]);
  }

  private async adminInsights(
    interval: InsightsInterval,
    organizationId: string,
  ) {
    const [
      submissions,
      confirmedTrend,
      allConfirmed,
      alertsCreated,
      allAlerts,
      users,
      teachers,
      reports,
    ] = await this.fetchAdminRows(organizationId, interval);

    const sections: InsightSection[] = [
      this.countTrend(
        'submissions_volume',
        'Submissions per week (school)',
        'area',
        submissions,
        interval,
      ),
      this.countTrend(
        'confirmed_grades',
        'Grades confirmed per week',
        'line',
        confirmedTrend,
        interval,
      ),
      this.percentTrend(
        'pass_rate_trend',
        'Pass rate per week',
        allConfirmed.map((s) => ({
          createdAt: s.createdAt,
          pct:
            s.criteria.maxPoints > 0 &&
            s.pointsAwarded / s.criteria.maxPoints >= PASS_RATIO
              ? 100
              : 0,
        })),
        interval,
      ),
      this.countTrend(
        'alerts_created',
        'Alerts created per week',
        'area',
        alertsCreated,
        interval,
      ),
      this.userGrowthBar(users, interval),
      this.teacherWorkloadBar(teachers),
      this.alertStatusDonut(allAlerts),
    ];

    const agentInsights: AgentInsight[] = [];
    for (const r of reports) {
      agentInsights.push({
        title: `${r.student.name} — management`,
        summary: this.reportSectionSummary(r.managementSection),
      });
    }
    for (const t of teachers) {
      const pending = t.teacherOfferings
        .flatMap((o) => o.assignments)
        .flatMap((a) => a.submissions)
        .flatMap((s) => s.scores)
        .filter((s) => !s.isConfirmed).length;
      const students = t.teacherOfferings.reduce(
        (sum, o) => sum + o.section.enrollments.length,
        0,
      );
      const confirmed = t.teacherOfferings
        .flatMap((o) => o.assignments)
        .flatMap((a) => a.submissions)
        .flatMap((s) => s.scores)
        .filter((s) => s.isConfirmed);
      const average = avgPercentage(
        confirmed.map((s) => ({
          pointsAwarded: s.pointsAwarded,
          maxPoints: s.criteria.maxPoints,
        })),
      );
      agentInsights.push({
        title: `${t.name} — workload`,
        summary: `Average ${average}% · ${pending} pending reviews · ${students} students`,
      });
    }

    return { sections, agentInsights };
  }

  // ── Shared section builders ──────────────────────────────────────────────

  private countTrend(
    key: string,
    title: string,
    chartType: ChartType,
    rows: { createdAt: Date }[],
    interval: InsightsInterval,
  ): InsightSection {
    const series = bucketize(rows, interval, TREND_BUCKETS);
    const current = series.slice(VISIBLE_BUCKETS);
    const sum = (points: SeriesPoint[]) =>
      points.reduce((a, b) => a + b.value, 0);
    return {
      key,
      title,
      chartType,
      series: current,
      delta: computeDelta(sum(current), sum(series.slice(0, VISIBLE_BUCKETS))),
    };
  }

  private rateTrend(
    key: string,
    title: string,
    rows: { date: Date; status: string }[],
    interval: InsightsInterval,
  ): InsightSection {
    const series = bucketizeRates(
      rows.map((r) => ({ date: r.date, present: r.status === 'PRESENT' })),
      interval,
      TREND_BUCKETS,
    );
    const current = series.slice(VISIBLE_BUCKETS);
    const avg = (points: SeriesPoint[]) =>
      points.length > 0
        ? points.reduce((a, b) => a + b.value, 0) / points.length
        : 0;
    return {
      key,
      title,
      chartType: 'line',
      series: current,
      delta: computeDelta(avg(current), avg(series.slice(0, VISIBLE_BUCKETS))),
    };
  }

  private percentTrend(
    key: string,
    title: string,
    rows: { createdAt: Date; pct: number }[],
    interval: InsightsInterval,
  ): InsightSection {
    const series = bucketizePercent(rows, interval, TREND_BUCKETS);
    const current = series.slice(VISIBLE_BUCKETS);
    const avg = (points: SeriesPoint[]) =>
      points.length > 0
        ? points.reduce((a, b) => a + b.value, 0) / points.length
        : 0;
    return {
      key,
      title,
      chartType: 'line',
      series: current,
      delta: computeDelta(avg(current), avg(series.slice(0, VISIBLE_BUCKETS))),
    };
  }

  private classAverageBar(
    confirmed: {
      pointsAwarded: number;
      criteria: { maxPoints: number };
      submission: {
        assignment: {
          offering: {
            course: { name: string };
            section: { name: string };
          };
        };
      };
    }[],
  ): InsightSection {
    const byClass = new Map<
      string,
      { pointsAwarded: number; maxPoints: number }[]
    >();
    for (const s of confirmed) {
      const name =
        s.submission.assignment.offering.course.name ??
        s.submission.assignment.offering.section.name;
      const bucket = byClass.get(name) ?? [];
      bucket.push({
        pointsAwarded: s.pointsAwarded,
        maxPoints: s.criteria.maxPoints,
      });
      byClass.set(name, bucket);
    }
    const series = Array.from(byClass.entries())
      .map(([label, scores]) => ({ label, value: avgPercentage(scores) }))
      .sort((a, b) => b.value - a.value);
    return {
      key: 'class_average',
      title: 'Average score per class',
      chartType: 'bar',
      series,
    };
  }

  private criterionAverageRadar(
    confirmed: {
      pointsAwarded: number;
      criteria: { maxPoints: number; description: string };
    }[],
    key = 'criterion_average',
    title = 'Average score per criterion',
  ): InsightSection {
    const byCriteria = new Map<
      string,
      { pointsAwarded: number; maxPoints: number }[]
    >();
    for (const s of confirmed) {
      const name = s.criteria.description;
      const bucket = byCriteria.get(name) ?? [];
      bucket.push({
        pointsAwarded: s.pointsAwarded,
        maxPoints: s.criteria.maxPoints,
      });
      byCriteria.set(name, bucket);
    }
    const series = Array.from(byCriteria.entries()).map(([label, scores]) => ({
      label,
      value: avgPercentage(scores),
    }));
    return { key, title, chartType: 'radar', series };
  }

  private criterionStrengthsRadar(
    confirmed: {
      pointsAwarded: number;
      criteria: { maxPoints: number; description: string };
    }[],
  ): InsightSection {
    return this.criterionAverageRadar(
      confirmed,
      'criterion_strengths',
      'Strengths by criterion',
    );
  }

  private strugglingStudentsBar(
    redirects: { student: { name: string } }[],
  ): InsightSection {
    const counts = new Map<string, number>();
    for (const r of redirects) {
      counts.set(r.student.name, (counts.get(r.student.name) ?? 0) + 1);
    }
    const series = Array.from(counts.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
    return {
      key: 'struggling_students',
      title: 'Homework-helper redirects per student',
      chartType: 'bar',
      series,
    };
  }

  private helpActionDonut(interactions: { action: string }[]): InsightSection {
    const counts = new Map<string, number>();
    for (const i of interactions) {
      counts.set(i.action, (counts.get(i.action) ?? 0) + 1);
    }
    const series = Array.from(counts.entries()).map(([label, value]) => ({
      label,
      value,
    }));
    return {
      key: 'help_action_split',
      title: 'Homework-helper outcomes',
      chartType: 'donut',
      series,
    };
  }

  private userGrowthBar(
    users: { createdAt: Date }[],
    interval: InsightsInterval,
  ): InsightSection {
    const series = bucketize(users, interval, VISIBLE_BUCKETS);
    return {
      key: 'user_growth',
      title: 'Students & teachers per bucket',
      chartType: 'bar',
      series,
    };
  }

  private teacherWorkloadBar(
    teachers: {
      name: string;
      teacherOfferings: {
        section: { enrollments: { id: string }[] };
        assignments: {
          submissions: { scores: { isConfirmed: boolean }[] }[];
        }[];
      }[];
    }[],
  ): InsightSection {
    const series = teachers.map((t) => {
      const pending = t.teacherOfferings
        .flatMap((o) => o.assignments)
        .flatMap((a) => a.submissions)
        .flatMap((s) => s.scores)
        .filter((s) => !s.isConfirmed).length;
      const students = t.teacherOfferings.reduce(
        (sum, o) => sum + o.section.enrollments.length,
        0,
      );
      return { label: t.name, value: pending + students };
    });
    series.sort((a, b) => b.value - a.value);
    return {
      key: 'teacher_workload',
      title: 'Students & pending reviews per teacher',
      chartType: 'bar',
      series,
    };
  }

  private alertStatusDonut(alerts: { status: string }[]): InsightSection {
    const counts = new Map<string, number>();
    for (const a of alerts) {
      counts.set(a.status, (counts.get(a.status) ?? 0) + 1);
    }
    const series = Array.from(counts.entries()).map(([label, value]) => ({
      label,
      value,
    }));
    return {
      key: 'alert_status_split',
      title: 'Alert status distribution',
      chartType: 'donut',
      series,
    };
  }

  private ratioToPercent(pointsAwarded: number, maxPoints: number): number {
    return maxPoints > 0
      ? Math.round((pointsAwarded / maxPoints) * 1000) / 10
      : 0;
  }

  private summarizeJson(content: unknown, fallback: string): string {
    if (content === null || content === undefined) return fallback;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.join(', ');
    const obj = content as Record<string, unknown>;
    if (Array.isArray(obj.skillGaps)) {
      return `Skill gaps: ${(obj.skillGaps as unknown[]).join(', ')}`;
    }
    return JSON.stringify(obj).slice(0, 200);
  }

  private reportSectionSummary(section: unknown): string {
    if (typeof section === 'string') return section;
    if (section && typeof section === 'object') {
      const obj = section as Record<string, unknown>;
      const text = obj.message ?? obj.analysis ?? obj.summary;
      if (typeof text === 'string') return text;
    }
    return '';
  }
}
