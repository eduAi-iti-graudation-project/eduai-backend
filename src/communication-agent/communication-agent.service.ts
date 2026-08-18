import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from '../reports/reports.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StudyLabService } from '../study-lab/study-lab.service';
import {
  type FlaggedVerdict,
  type StudentProfile,
} from './dto';
import { CommunicationWorkflow } from './communication-workflow';
import {
  createGetStudentProfileTool,
  createCreateAlertTool,
  type StudentProfileTool,
  type CreateAlertTool,
} from './tools';
import {
  submissionPcts,
  summarizeStudentSeries,
  summarizeClass,
  scorePercentage,
  verdict,
  submissionCriterionSeries,
  criterionStatsFromSeries,
  weakCriterion,
  type ClassStats,
  type StudentStats,
  type ScorePoint,
  type CriterionStat,
} from './trends';

@Injectable()
export class CommunicationAgentService {
  private readonly logger = new Logger(CommunicationAgentService.name);
  private readonly getStudentProfileTool: StudentProfileTool;
  private readonly createAlertTool: CreateAlertTool;

  constructor(
    private readonly prisma: PrismaService,
    private readonly workflow: CommunicationWorkflow,
    private readonly reportsService: ReportsService,
    private readonly notificationsService: NotificationsService,
    private readonly studyLabService: StudyLabService,
  ) {
    this.getStudentProfileTool = createGetStudentProfileTool(this.prisma);
    this.createAlertTool = createCreateAlertTool(this.prisma);
  }

  async analyze(submissionId: string): Promise<void> {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        assignment: {
          include: {
            offering: { select: { organizationId: true, id: true } },
          },
        },
        student: true,
      },
    });
    if (!submission) {
      this.logger.warn(`Submission ${submissionId} not found`);
      return;
    }

    const organization = await this.prisma.organization.findUnique({
      where: { id: submission.assignment.offering.organizationId },
      select: { subscriptionStatus: true, subscriptionTier: true },
    });
    const enterpriseAccess =
      organization?.subscriptionStatus === 'TRIALING' ||
      organization?.subscriptionTier === 'ENTERPRISE';
    if (!enterpriseAccess) {
      this.logger.log(
        `Skipping communication agent for ${submissionId}: organization is not on Trial/Enterprise`,
      );
      return;
    }

    const studentId = submission.studentId;
    const courseOfferingId = submission.assignment.offering.id;

    const alreadyAnalyzed = await this.prisma.studentAnalysis.findFirst({
      where: { submissionId, alertId: { not: null } },
      select: { id: true },
    });
    if (alreadyAnalyzed) {
      this.logger.log(
        `Skipping communication agent for ${submissionId}: already analyzed`,
      );
      return;
    }

    const confirmedCount = await this.prisma.submission.count({
      where: {
        studentId,
        status: 'CONFIRMED',
        scores: { some: { isConfirmed: true } },
      },
    });

    if (confirmedCount < 2) {
      this.logger.debug(
        `Skipping analysis for ${studentId}: only ${confirmedCount} confirmed submissions`,
      );
      return;
    }

    const profile = await this.getStudentProfileTool.execute({ studentId });

    const studentSeries = submissionPcts(
      profile.grades.map((g) => ({
        studentId,
        submissionId: g.submissionId,
        pct: g.percentage,
        createdAt: g.createdAt,
      })),
    );
    const studentStats = summarizeStudentSeries(studentSeries);

    const criterionStats: CriterionStat[] = criterionStatsFromSeries(
      submissionCriterionSeries(
        profile.grades.map((g) => ({
          submissionId: g.submissionId,
          criteriaId: g.criteriaId,
          criteriaDescription: g.criteriaDescription,
          pct: g.percentage,
          createdAt: g.createdAt,
        })),
      ),
    );
    const weakCriteria = weakCriterion(criterionStats);

    const classStats = await this.buildClassStats(courseOfferingId);
    const recentlyFlagged = profile.previousAlerts.some(
      (a) => a.status === 'ACTIVE',
    );
    let decision = verdict(studentStats, classStats, recentlyFlagged);

    if (!decision.flagged && weakCriteria.length > 0) {
      decision = {
        flagged: true,
        type: recentlyFlagged ? 'CONSISTENT_STRUGGLE' : 'WEAK_CRITERION',
        severity: 'MEDIUM',
        attribution: 'STUDENT',
      };
    }

    if (!decision.flagged) {
      await this.prisma.studentAnalysis.create({
        data: {
          submissionId,
          studentId,
          courseOfferingId,
          diagnosis: {
            decision: 'none',
            studentStats,
            classStats,
            criterionStats,
          },
        },
      });
      this.logger.log(`No issue detected for student ${studentId}`);
      return;
    }

    const offeringName =
      decision.attribution !== 'STUDENT'
        ? await this.offeringName(courseOfferingId)
        : null;

    const result = await this.workflow.run({
      studentName: profile.studentName,
      decision,
      studentStats,
      classStats,
      criterionStats,
      weakCriteria: weakCriteria.map((c) => ({
        criteriaId: c.criteriaId,
        description: c.criteriaDescription,
        avgPct: Math.round(c.last3AvgPct),
      })),
      recentGrades: profile.grades.slice(0, 5).map((g) => ({
        pct: g.percentage,
        criteria: g.criteriaDescription,
      })),
      offeringName,
    });

    const flagged = result.decision;
    this.logger.debug(
      `Verdict for ${studentId}: ${JSON.stringify(flagged)} — ${result.explanation.reason}`,
    );

    const alert = await this.createAlertTool.execute({
      studentId,
      type: flagged.type,
      reason: result.explanation.reason,
    });

    const offering = await this.prisma.courseOffering.findUnique({
      where: { id: courseOfferingId },
    });
    if (offering?.teacherId) {
      await this.notificationsService.notifyUser(
        offering.teacherId,
        'AGENT_ALERT',
        `Student flagged: ${profile.studentName}`,
        [
          `Analysis: ${result.teacherContent.analysis}`,
          `Skill gaps: ${result.teacherContent.skillGaps.join(', ')}`,
          `Interventions: ${result.teacherContent.interventions.join(', ')}`,
          `Resources: ${result.teacherContent.resourceSuggestions.join(', ')}`,
        ].join('\n'),
      );
    }

    const student = await this.prisma.user.findUnique({
      where: { id: studentId },
    });
    if (student?.guardianId) {
      await this.notificationsService.notifyUser(
        student.guardianId,
        'AGENT_ALERT',
        `Academic alert for ${profile.studentName}`,
        result.guardianContent.message,
      );
    }

    if (flagged.attribution !== 'STUDENT' && classStats.studentCount >= 2) {
      await this.notificationsService.notifyUser(
        offering?.teacherId ?? '',
        'AGENT_ALERT',
        `Class performance insight: ${offeringName ?? 'the class'}`,
        result.teacherFeedback?.feedback ?? '',
      );

      const admins = await this.prisma.user.findMany({
        where: { role: 'ADMIN' },
      });
      for (const admin of admins) {
        await this.notificationsService.notifyUser(
          admin.id,
          'AGENT_ALERT',
          `Management summary: ${offeringName ?? 'the class'}`,
          result.managementSummary?.summary ?? '',
        );
      }
    }

    this.reportsService
      .generate(studentId, alert.alertId)
      .catch((err) =>
        this.logger.error(
          `Failed to generate report for alert ${alert.alertId}`,
          err,
        ),
      );

    const analysis = await this.prisma.studentAnalysis.create({
      data: {
        submissionId,
        studentId,
        courseOfferingId,
        alertId: alert.alertId,
        diagnosis: {
          type: flagged.type,
          severity: flagged.severity,
          attribution: flagged.attribution,
          reason: result.explanation.reason,
          brief: {
            headline: result.explanation.headline,
            highlights: result.explanation.highlights,
            strengths: result.explanation.strengths,
            concerns: result.explanation.concerns,
            recommendation: result.explanation.recommendation,
          },
          council: result.council,
          review: result.review,
          studentStats,
          classStats,
          criterionStats,
          weakCriteria: weakCriteria.map((c) => ({
            criteriaId: c.criteriaId,
            description: c.criteriaDescription,
            avgPct: Math.round(c.last3AvgPct),
          })),
        },
        teacherContent: result.teacherContent,
        guardianContent: result.guardianContent,
        teacherFeedback: result.teacherFeedback ?? undefined,
        managementSummary: result.managementSummary ?? undefined,
      },
    });

    await this.recommendPractice(
      profile.studentName,
      studentId,
      courseOfferingId,
      analysis.id,
      weakCriteria,
      result.explanation.concerns,
    );
  }

  private async recommendPractice(
    studentName: string,
    studentId: string,
    courseOfferingId: string,
    analysisId: string,
    weakCriteria: CriterionStat[],
    concerns: string[],
  ): Promise<void> {
    const focus = weakCriteria[0]?.criteriaDescription ?? concerns[0];
    if (!focus) {
      this.logger.log(`[agent] no practice topic detected for ${studentId}`);
      return;
    }

    try {
      const generationId = await this.studyLabService.recommend(
        studentId,
        courseOfferingId,
        focus,
        analysisId,
      );
      this.logger.log(
        `[agent] recommended practice ${generationId} for ${studentId} on "${focus}"`,
      );
      await this.notificationsService.notifyUser(
        studentId,
        'AGENT_ALERT',
        `New practice recommended for you`,
        `We found one area to work on: "${focus}". Open Study Lab → Practice questions to train on it before the next assessment.`,
      );
    } catch (err: unknown) {
      this.logger.error(
        `[agent] failed to recommend practice for ${studentId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async buildClassStats(courseOfferingId: string): Promise<ClassStats> {
    const scores = await this.prisma.gradingScore.findMany({
      where: {
        submission: { assignment: { courseOfferingId }, status: 'CONFIRMED' },
        isConfirmed: true,
      },
      include: {
        criteria: { select: { maxPoints: true } },
        submission: { select: { id: true, studentId: true, createdAt: true } },
      },
    });

    const byStudent = new Map<string, ScorePoint[]>();
    for (const score of scores) {
      const studentId = score.submission.studentId;
      const pct =
        score.criteria.maxPoints > 0
          ? scorePercentage(score.pointsAwarded, score.criteria.maxPoints)
          : 0;
      const rows = byStudent.get(studentId) ?? [];
      rows.push({
        studentId,
        submissionId: score.submission.id,
        pct,
        createdAt: score.submission.createdAt.toISOString(),
      });
      byStudent.set(studentId, rows);
    }

    return summarizeClass(
      Array.from(byStudent.values()).map((rows) => submissionPcts(rows)),
    );
  }

  private async offeringName(courseOfferingId: string): Promise<string | null> {
    const offering = await this.prisma.courseOffering.findUnique({
      where: { id: courseOfferingId },
      include: { course: true, section: true },
    });
    if (!offering) return null;
    return offering.section?.name
      ? `${offering.course.name} — ${offering.section.name}`
      : offering.course.name;
  }
}

