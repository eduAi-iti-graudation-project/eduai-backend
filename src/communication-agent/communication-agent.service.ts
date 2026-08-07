import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';
import { FORMATTING_RULES } from '../common/llm/formatting-rules';
import { ReportsService } from '../reports/reports.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  ExplanationSchema,
  TeacherStudentContentSchema,
  GuardianStudentContentSchema,
  TeacherFeedbackSchema,
  ManagementSummarySchema,
  type Explanation,
  type TeacherStudentContent,
  type GuardianStudentContent,
  type TeacherFeedback,
  type ManagementSummary,
  type StudentProfile,
} from './dto';
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

type FlaggedVerdict = {
  flagged: true;
  type: 'FAILING' | 'DOWNWARD_TREND' | 'CONSISTENT_STRUGGLE' | 'WEAK_CRITERION';
  severity: 'MEDIUM' | 'HIGH';
  attribution: 'STUDENT' | 'CLASS' | 'BOTH';
};

@Injectable()
export class CommunicationAgentService {
  private readonly logger = new Logger(CommunicationAgentService.name);
  private readonly getStudentProfileTool: StudentProfileTool;
  private readonly createAlertTool: CreateAlertTool;

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService,
    private readonly reportsService: ReportsService,
    private readonly notificationsService: NotificationsService,
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

    const explanation = await this.llmService.generateStructured<Explanation>({
      systemPrompt:
        'You are an educational analyst. Turn the numbers below into a precise, scannable brief for a teacher and a parent. ' +
        'Reference the actual numbers. Keep every bullet short (a few words), never sentences longer than ~15 words.\n' +
        'Return valid JSON with EXACTLY these fields:\n' +
        '{\n' +
        '  "reason": "string — one paragraph (3-5 sentences) explaining what the numbers show",\n' +
        '  "headline": "string — short one-line verdict, e.g. "Omar is at risk in English Literature"",\n' +
        '  "highlights": ["string — 3-5 short factual bullets citing the numbers"],\n' +
        '  "strengths": ["string — 1-3 skills done well, with percentage when known"],\n' +
        '  "concerns": ["string — 1-4 skills needing work, with percentage when known"],\n' +
        '  "recommendation": "string — one short actionable next step"\n' +
        '}\n' +
        'Do not omit any fields.' +
        FORMATTING_RULES,
      userPrompt: JSON.stringify({
        studentName: profile.studentName,
        studentStats,
        classStats,
        criterionStats,
        weakCriteria: weakCriteria.map((c) => ({
          criteriaId: c.criteriaId,
          description: c.criteriaDescription,
          avgPct: Math.round(c.last3AvgPct),
        })),
        recentGrades: profile.grades.slice(0, 5),
      }),
      schema: ExplanationSchema,
    });

    const flagged: FlaggedVerdict = decision;
    this.logger.debug(
      `Verdict for ${studentId}: ${JSON.stringify(flagged)} — ${explanation.reason}`,
    );

    const teacherIssue = flagged.attribution !== 'STUDENT';

    const [studentResult, teacherResult] = await Promise.all([
      this.handleStudentIssue(
        submissionId,
        studentId,
        courseOfferingId,
        classStats,
        profile,
        flagged,
        explanation.reason,
        studentStats,
        criterionStats,
      ),
      teacherIssue
        ? this.handleTeacherIssue(
            courseOfferingId,
            classStats,
            explanation.reason,
          )
        : Promise.resolve(null),
    ]);

    await this.prisma.studentAnalysis.create({
      data: {
        submissionId,
        studentId,
        courseOfferingId,
        alertId: studentResult.alertId ?? null,
        diagnosis: {
          type: flagged.type,
          severity: flagged.severity,
          attribution: flagged.attribution,
          reason: explanation.reason,
          brief: {
            headline: explanation.headline,
            highlights: explanation.highlights,
            strengths: explanation.strengths,
            concerns: explanation.concerns,
            recommendation: explanation.recommendation,
          },
          studentStats,
          classStats,
          criterionStats,
          weakCriteria: weakCriteria.map((c) => ({
            criteriaId: c.criteriaId,
            description: c.criteriaDescription,
            avgPct: Math.round(c.last3AvgPct),
          })),
        },
        teacherContent: studentResult.teacherContent ?? undefined,
        guardianContent: studentResult.guardianContent ?? undefined,
        teacherFeedback: teacherResult?.teacherFeedback ?? undefined,
        managementSummary: teacherResult?.managementSummary ?? undefined,
      },
    });
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

  private async handleStudentIssue(
    submissionId: string,
    studentId: string,
    courseOfferingId: string,
    classStats: ClassStats,
    profile: StudentProfile,
    decision: FlaggedVerdict,
    reason: string,
    studentStats: StudentStats,
    criterionStats: CriterionStat[],
  ): Promise<{
    alertId: string;
    teacherContent: TeacherStudentContent;
    guardianContent: GuardianStudentContent;
  }> {
    const recentGrades = profile.grades.slice(0, 5).map((g) => ({
      pct: g.percentage,
      criteria: g.criteriaDescription,
    }));

    const [teacherContent, guardianContent] = await Promise.all([
      this.llmService.generateStructured<TeacherStudentContent>({
        systemPrompt:
          'You are a teacher advisor. Given a student diagnosis and their actual performance numbers, ' +
          'provide detailed analysis, skill gaps, interventions, and resource suggestions.\n' +
          'Return valid JSON with EXACTLY these fields:\n' +
          '{\n' +
          '  "analysis": "string — detailed analysis grounded in the numbers",\n' +
          '  "skillGaps": ["string array of identified skill gaps"],\n' +
          '  "interventions": ["string array of suggested interventions"],\n' +
          '  "resourceSuggestions": ["string array of recommended resources"]\n' +
          '}\n' +
          'Do not omit any fields.',
        userPrompt: JSON.stringify({
          studentName: profile.studentName,
          issueType: decision.type,
          summary: reason,
          severity: decision.severity,
          studentStats,
          classStats,
          criterionStats,
          recentGrades,
        }),
        schema: TeacherStudentContentSchema,
      }),
      this.llmService.generateStructured<GuardianStudentContent>({
        systemPrompt:
          'You are a parent liaison. Given a student diagnosis, write an empathetic, specific message ' +
          'for the parent and suggest home support strategies.\n' +
          'Return valid JSON with EXACTLY these fields:\n' +
          '{\n' +
          '  "message": "string with empathetic message for the parent",\n' +
          '  "homeSupport": ["string array of home support strategies"]\n' +
          '}\n' +
          'Do not omit any fields.',
        userPrompt: JSON.stringify({
          studentName: profile.studentName,
          summary: reason,
          severity: decision.severity,
        }),
        schema: GuardianStudentContentSchema,
      }),
    ]);

    const alert = await this.createAlertTool.execute({
      studentId,
      type: decision.type,
      reason,
    });

    const offeringInfo = await this.prisma.courseOffering.findUnique({
      where: { id: courseOfferingId },
    });
    if (offeringInfo?.teacherId) {
      await this.notificationsService.notifyUser(
        offeringInfo.teacherId,
        'AGENT_ALERT',
        `Student flagged: ${profile.studentName}`,
        [
          `Analysis: ${teacherContent.analysis}`,
          `Skill gaps: ${teacherContent.skillGaps.join(', ')}`,
          `Interventions: ${teacherContent.interventions.join(', ')}`,
          `Resources: ${teacherContent.resourceSuggestions.join(', ')}`,
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
        guardianContent.message,
      );
    }

    this.reportsService
      .generate(studentId, alert.alertId)
      .catch((err) =>
        this.logger.error(
          `Failed to generate report for alert ${alert.alertId}`,
          err,
        ),
      );

    return { alertId: alert.alertId, teacherContent, guardianContent };
  }

  private async handleTeacherIssue(
    courseOfferingId: string,
    classStats: ClassStats,
    reason: string,
  ): Promise<{
    teacherFeedback: TeacherFeedback;
    managementSummary: ManagementSummary;
  } | null> {
    if (classStats.studentCount < 2) return null;

    const offering = await this.prisma.courseOffering.findUnique({
      where: { id: courseOfferingId },
      include: { course: true, section: true },
    });
    if (!offering) return null;

    const offeringName = offering.section?.name
      ? `${offering.course.name} — ${offering.section.name}`
      : offering.course.name;

    const [teacherFeedback, managementSummary] = await Promise.all([
      this.llmService.generateStructured<TeacherFeedback>({
        systemPrompt:
          'You are a peer coach for teachers. Given class statistics showing a class-wide issue, ' +
          'provide constructive feedback, pattern analysis, and actionable strategies.\n' +
          'Return valid JSON with EXACTLY these fields:\n' +
          '{\n' +
          '  "feedback": "string with constructive feedback",\n' +
          '  "patternAnalysis": "string describing observed patterns",\n' +
          '  "strategies": ["string array of actionable strategies"]\n' +
          '}\n' +
          'Do not omit any fields.',
        userPrompt: JSON.stringify({
          className: offeringName,
          classStats,
          reason,
        }),
        schema: TeacherFeedbackSchema,
      }),
      this.llmService.generateStructured<ManagementSummary>({
        systemPrompt:
          'You are a school management advisor. Given class statistics, provide a concise summary, ' +
          'class trend, and recommendation for administration.\n' +
          'Return valid JSON with EXACTLY these fields:\n' +
          '{\n' +
          '  "summary": "string with concise summary",\n' +
          '  "classTrend": "string describing class trend over time",\n' +
          '  "recommendation": "string with recommendation for administration"\n' +
          '}\n' +
          'Do not omit any fields.',
        userPrompt: JSON.stringify({
          className: offeringName,
          classStats,
          reason,
        }),
        schema: ManagementSummarySchema,
      }),
    ]);

    await this.notificationsService.notifyUser(
      offering.teacherId,
      'AGENT_ALERT',
      `Class performance insight: ${offeringName}`,
      teacherFeedback.feedback,
    );

    const admins = await this.prisma.user.findMany({
      where: { role: 'ADMIN' },
    });
    for (const admin of admins) {
      await this.notificationsService.notifyUser(
        admin.id,
        'AGENT_ALERT',
        `Management summary: ${offeringName}`,
        managementSummary.summary,
      );
    }

    return { teacherFeedback, managementSummary };
  }
}
