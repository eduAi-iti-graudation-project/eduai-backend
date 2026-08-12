import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';
import { FORMATTING_RULES } from '../common/llm/formatting-rules';
import { ReportsService } from '../reports/reports.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StudyLabService } from '../study-lab/study-lab.service';
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

    const explanation = await this.safeStructured<Explanation>(
      'explanation',
      () =>
        this.llmService.generateStructured<Explanation>({
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
        }),
      this.buildFallbackExplanation(
        profile.studentName,
        decision,
        studentStats,
        classStats,
        criterionStats,
        weakCriteria,
      ),
    );

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

    const analysis = await this.prisma.studentAnalysis.create({
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

    await this.recommendPractice(
      profile.studentName,
      studentId,
      courseOfferingId,
      analysis.id,
      weakCriteria,
      explanation.concerns,
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
      this.safeStructured<TeacherStudentContent>(
        'teacher content',
        () =>
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
        this.buildTeacherStudentContent(
          profile.studentName,
          decision,
          reason,
          studentStats,
          classStats,
          criterionStats,
        ),
      ),
      this.safeStructured<GuardianStudentContent>(
        'guardian content',
        () =>
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
        this.buildGuardianContent(profile.studentName, reason, decision),
      ),
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

  private async safeStructured<T>(
    label: string,
    generate: () => Promise<T>,
    fallback: T,
  ): Promise<T> {
    try {
      return await generate();
    } catch (err: unknown) {
      this.logger.error(
        `[agent] ${label} generation failed — using deterministic fallback: ${err instanceof Error ? err.message : String(err)}`,
      );
      return fallback;
    }
  }

  private buildFallbackExplanation(
    studentName: string,
    flagged: FlaggedVerdict,
    studentStats: StudentStats,
    classStats: ClassStats,
    criterionStats: CriterionStat[],
    weakCriteria: CriterionStat[],
  ): Explanation {
    const weakest = weakCriteria[0]?.criteriaDescription;
    const head = weakest
      ? `Weakest area: ${weakest}`
      : 'Recent scores are below the class average';
    const highlights = [
      `Average of last ${studentStats.count} graded submissions: ${Math.round(studentStats.last3AvgPct)}%`,
      `Class average: ${Math.round(classStats.classAvgPct)}%`,
    ];
    if (weakCriteria.length > 0) {
      highlights.push(
        `${weakCriteria[0]?.criteriaDescription} — ${Math.round(weakCriteria[0]?.last3AvgPct ?? 0)}%`,
      );
    }
    const concerns = weakCriteria
      .slice(0, 4)
      .map((c) => `${c.criteriaDescription} (${Math.round(c.last3AvgPct)}%)`);
    const strengths = criterionStats
      .filter((c) => c.last3AvgPct >= 70)
      .slice(0, 3)
      .map((c) => `${c.criteriaDescription} (${Math.round(c.last3AvgPct)}%)`);
    return {
      reason: `${studentName} is flagged (${flagged.type.toLowerCase().replace('_', ' ')}). Over the last ${studentStats.count} graded submissions the average is ${Math.round(studentStats.last3AvgPct)}%, compared with a class average of ${Math.round(classStats.classAvgPct)}%. The pattern indicates the student needs targeted support.`,
      headline: `${studentName} is at risk and needs support`,
      highlights,
      strengths: strengths.length > 0 ? strengths : ['—'],
      concerns:
        concerns.length > 0 ? concerns : ['Overall performance below target'],
      recommendation: `${head}. Assign the recommended practice set and schedule a check-in.`,
    };
  }

  private buildTeacherStudentContent(
    studentName: string,
    decision: FlaggedVerdict,
    reason: string,
    studentStats: StudentStats,
    classStats: ClassStats,
    criterionStats: CriterionStat[],
  ): TeacherStudentContent {
    const below = criterionStats
      .filter((c) => c.last3AvgPct < 60)
      .slice(0, 3)
      .map((c) => c.criteriaDescription);
    return {
      analysis: `${studentName} is showing a ${decision.type.toLowerCase().replace('_', ' ')} pattern (${Math.round(studentStats.last3AvgPct)}% vs class ${Math.round(classStats.classAvgPct)}%). ${reason}`,
      skillGaps:
        below.length > 0 ? below : ['Core concepts need reinforcement'],
      interventions: [
        'Generate the recommended practice set and have the student complete it',
        'Hold a 1:1 check-in to identify the root cause',
      ],
      resourceSuggestions: [
        'Study Lab practice questions on the weak criteria',
        'Office hours before the next assessment',
      ],
    };
  }

  private buildGuardianContent(
    studentName: string,
    reason: string,
    decision: FlaggedVerdict,
  ): GuardianStudentContent {
    return {
      message: `We have observed that ${studentName} is having difficulty in at least one area (${decision.type.toLowerCase().replace('_', ' ')}). ${reason} We are adding a recommended practice set in Study Lab and will follow up with you.`,
      homeSupport: [
        'Help your child complete the recommended practice set in Study Lab',
        'Create a quiet, consistent study schedule this week',
        'Reach out to the teacher with any questions after the alert',
      ],
    };
  }
}
