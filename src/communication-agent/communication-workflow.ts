import { Injectable, Logger } from '@nestjs/common';
import { Agent } from '@mastra/core/agent';
import type { LanguageModelV2 } from '@ai-sdk/provider';
import { LlmService } from '../common/llm/llm.service';
import { FORMATTING_RULES } from '../common/llm/formatting-rules';
import { createGatewayLanguageModel } from '../struggle-signals/gateway-language-model';
import {
  CouncilVerdictSchema,
  ExplanationSchema,
  GuardianStudentContentSchema,
  ManagementSummarySchema,
  ReviewerSchema,
  TeacherFeedbackSchema,
  TeacherStudentContentSchema,
  type CouncilVerdict,
  type Explanation,
  type FlaggedVerdict,
  type GuardianStudentContent,
  type ManagementSummary,
  type ReviewerAssessment,
  type TeacherFeedback,
  type TeacherStudentContent,
} from './dto';
import type { ClassStats, CriterionStat, StudentStats } from './trends';

export interface CommunicationWorkflowInput {
  studentName: string;
  decision: FlaggedVerdict;
  studentStats: StudentStats;
  classStats: ClassStats;
  criterionStats: CriterionStat[];
  weakCriteria: Array<{ criteriaId: string; description: string; avgPct: number }>;
  recentGrades: Array<{ pct: number; criteria: string }>;
  offeringName?: string | null;
}

export type CouncilOutcome = {
  consulted: true;
  /** Both auditors flagged — the council confirms the HIGH verdict. */
  confirmed: boolean;
  /** Both auditors cleared the student — downgrade to MEDIUM. */
  downgraded: boolean;
  /** Both auditors reached the same verdict. */
  unanimous: boolean;
  note: string;
};

export type ReviewOutcome = {
  approved: boolean;
  note: string;
};

export interface CommunicationWorkflowResult {
  explanation: Explanation;
  decision: FlaggedVerdict;
  council: CouncilOutcome | null;
  teacherContent: TeacherStudentContent;
  guardianContent: GuardianStudentContent;
  teacherFeedback: TeacherFeedback | null;
  managementSummary: ManagementSummary | null;
  review: ReviewOutcome | null;
}

const DIAGNOSER_PROMPT =
  'You are an educational analyst. Turn the numbers below into a precise, scannable brief for a teacher and a parent. ' +
  'Reference the actual numbers. Keep every bullet short (a few words), never sentences longer than ~15 words.\n' +
  'Return valid JSON with EXACTLY these fields:\n' +
  '{\n' +
  '  "reason": "string — a structured markdown brief: open with ONE bolded takeaway sentence, then 1-2 short labelled sections (### Key numbers, ### What is driving this) with 2-4 bullets each",\n' +
  '  "headline": "string — short one-line verdict, e.g. "Omar is at risk in English Literature"",\n' +
  '  "highlights": ["string — 3-5 short factual bullets citing the numbers"],\n' +
  '  "strengths": ["string — 1-3 skills done well, with percentage when known"],\n' +
  '  "concerns": ["string — 1-4 skills needing work, with percentage when known"],\n' +
  '  "recommendation": "string — one short actionable next step"\n' +
  '}\n' +
  'Do not omit any fields.' +
  FORMATTING_RULES;

const COUNCIL_PROMPT = `You are an independent educational auditor serving on a review council. A deterministic system has auto-flagged a student as HIGH risk. Your job is to independently verify that verdict against the raw numbers below.

Grounding rules:
- Do NOT rubber-stamp the verdict. It is justified only if the numbers themselves clearly support flagging (failing average, repeated drops, or consistently weak criteria).
- Consider both the student's own trend and their position relative to the class.
- Be conservative: a false alarm disrupts parents and teachers, but ignoring a real pattern harms the student.

Respond with ONLY valid JSON: {"flagged": true|false, "reason": "string", "confidence": "LOW"|"MEDIUM"|"HIGH"}.`;

const TEACHER_ADVISOR_PROMPT = `You are a teacher advisor. Given a student diagnosis and their actual performance numbers, provide detailed analysis, skill gaps, interventions, and resource suggestions.
Return valid JSON with EXACTLY these fields:
{
  "analysis": "string — structured markdown analysis grounded in the numbers. Open with ONE bolded takeaway sentence, then use labelled sections with bullet lists, e.g. "### Key numbers" (cite the averages and gaps), "### Strengths", "### Main concerns", "### What is driving the score". Never write one dense paragraph.",
  "skillGaps": ["string array of identified skill gaps, each short"],
  "interventions": ["string array of suggested interventions, each short and concrete"],
  "resourceSuggestions": ["string array of recommended resources, each short"]
}
Do not omit any fields.${FORMATTING_RULES}`;

const PARENT_LIAISON_PROMPT = `You are a parent liaison. Given a student diagnosis, write an empathetic, specific message for the parent and suggest home support strategies.
Return valid JSON with EXACTLY these fields:
{
  "message": "string — structured markdown message: open with ONE bolded, empathetic takeaway, then a short "### What you can do at home" bullet list of 2-3 concrete actions. Keep it warm and short.",
  "homeSupport": ["string array of home support strategies, each short and concrete"]
}
Do not omit any fields.${FORMATTING_RULES}`;

const PEER_COACH_PROMPT = `You are a peer coach for teachers. Given class statistics showing a class-wide issue, provide constructive feedback, pattern analysis, and actionable strategies.
Return valid JSON with EXACTLY these fields:
{
  "feedback": "string — structured markdown: open with ONE bolded takeaway, then a short "### Patterns" bullet list citing the class numbers",
  "patternAnalysis": "string — 2-3 short bullets describing observed patterns",
  "strategies": ["string array of actionable strategies, each short and concrete"]
}
Do not omit any fields.${FORMATTING_RULES}`;

const MANAGEMENT_ADVISOR_PROMPT = `You are a school management advisor. Given class statistics, provide a concise summary, class trend, and recommendation for administration.
Return valid JSON with EXACTLY these fields:
{
  "summary": "string — structured markdown: ONE bolded takeaway, then a short "### Highlights" bullet list citing the class numbers",
  "classTrend": "string — one or two short bullets describing class trend over time",
  "recommendation": "string — one short, concrete recommendation for administration"
}
Do not omit any fields.${FORMATTING_RULES}`;

const REVIEWER_PROMPT = `You are the final reviewer of a school's communication department. You are given a flagged verdict, the diagnosis brief, and the draft messages for the teacher, the guardian, and (when present) the management summary.
Check that:
- every message is grounded in the numbers actually provided (no invented figures),
- each message is scoped correctly (student-level vs class-level),
- nothing is empty or truncated.

Respond with ONLY valid JSON: {"approved": true|false, "note": "string — one line summarizing the review"}.`;

/**
 * Multi-agent communication workflow.
 *
 * The ITI gateway model cannot emit tool calls, so Mastra's framework-level
 * `agents:` delegation is unreachable here. This workflow instead orchestrates
 * Mastra `Agent` primitives in code:
 *   1. A diagnoser agent writes the explanation brief.
 *   2. For HIGH-risk verdicts, a two-member council of independent auditors
 *      double-checks the deterministic verdict in parallel (downgrades to
 *      MEDIUM when both auditors clear the student).
 *   3. Writer agents (teacher advisor, parent liaison, peer coach, management
 *      advisor) compose the per-recipient messages in parallel.
 *   4. A reviewer agent judges the composed output before it is sent.
 * Every delegation fails over to a deterministic fallback rather than aborting.
 */
@Injectable()
export class CommunicationWorkflow {
  private readonly logger = new Logger(CommunicationWorkflow.name);

  private readonly diagnoser: Agent;
  private readonly analysts: [Agent, Agent];
  private readonly teacherAdvisor: Agent;
  private readonly parentLiaison: Agent;
  private readonly peerCoach: Agent;
  private readonly managementAdvisor: Agent;
  private readonly reviewer: Agent;

  constructor(llmService: LlmService) {
    const model = createGatewayLanguageModel((systemPrompt, userPrompt) =>
      llmService.chat(systemPrompt, userPrompt),
    );
    this.diagnoser = this.buildAgent('comm-diagnoser', DIAGNOSER_PROMPT, model);
    this.analysts = [
      this.buildAgent(
        'comm-council-a',
        `${COUNCIL_PROMPT}\nYou are Auditor A. You have a reputation for catching false positives — flag only when the numbers clearly support it.`,
        model,
      ),
      this.buildAgent(
        'comm-council-b',
        `${COUNCIL_PROMPT}\nYou are Auditor B. You have a reputation for catching missed signals — but you still need the numbers to back a flag.`,
        model,
      ),
    ];
    this.teacherAdvisor = this.buildAgent(
      'comm-teacher-advisor',
      TEACHER_ADVISOR_PROMPT,
      model,
    );
    this.parentLiaison = this.buildAgent(
      'comm-parent-liaison',
      PARENT_LIAISON_PROMPT,
      model,
    );
    this.peerCoach = this.buildAgent('comm-peer-coach', PEER_COACH_PROMPT, model);
    this.managementAdvisor = this.buildAgent(
      'comm-management-advisor',
      MANAGEMENT_ADVISOR_PROMPT,
      model,
    );
    this.reviewer = this.buildAgent('comm-reviewer', REVIEWER_PROMPT, model);
  }

  private buildAgent(
    id: string,
    instructions: string,
    model: LanguageModelV2,
  ): Agent {
    return new Agent({ id, name: id, instructions, model });
  }

  async run(input: CommunicationWorkflowInput): Promise<CommunicationWorkflowResult> {
    const { decision, studentName, classStats } = input;

    const explanation = await this.safeStructured<Explanation>(
      'diagnosis',
      () =>
        this.diagnoser.generate(this.diagnoserPrompt(input), {
          structuredOutput: { schema: ExplanationSchema },
        }).then((r) => r.object),
      this.buildFallbackExplanation(input),
    );

    let activeDecision = decision;
    let council: CouncilOutcome | null = null;
    if (decision.severity === 'HIGH') {
      council = await this.runCouncil(input);
      if (council.downgraded) {
        activeDecision = { ...decision, severity: 'MEDIUM' };
      }
    }

    const teacherIssue =
      activeDecision.attribution !== 'STUDENT' && classStats.studentCount >= 2;

    const [teacherContent, guardianContent, teacherFeedback, managementSummary] =
      await Promise.all([
        this.safeStructured<TeacherStudentContent>(
          'teacher content',
          () =>
            this.teacherAdvisor.generate(this.teacherAdvisorPrompt(input, explanation.reason), {
              structuredOutput: { schema: TeacherStudentContentSchema },
            }).then((r) => r.object),
          this.buildTeacherStudentContent(input),
        ),
        this.safeStructured<GuardianStudentContent>(
          'guardian content',
          () =>
            this.parentLiaison.generate(this.parentLiaisonPrompt(input, explanation.reason), {
              structuredOutput: { schema: GuardianStudentContentSchema },
            }).then((r) => r.object),
          this.buildGuardianContent(input),
        ),
        teacherIssue
          ? this.safeStructured<TeacherFeedback>(
              'teacher feedback',
              () =>
                this.peerCoach.generate(this.peerCoachPrompt(input, explanation.reason), {
                  structuredOutput: { schema: TeacherFeedbackSchema },
                }).then((r) => r.object),
              this.buildTeacherFeedback(input),
            )
          : Promise.resolve(null),
        teacherIssue
          ? this.safeStructured<ManagementSummary>(
              'management summary',
              () =>
                this.managementAdvisor.generate(
                  this.managementAdvisorPrompt(input, explanation.reason),
                  { structuredOutput: { schema: ManagementSummarySchema } },
                ).then((r) => r.object),
              this.buildManagementSummary(input),
            )
          : Promise.resolve(null),
      ]);

    let review: ReviewOutcome | null = null;
    try {
      const assessment = await this.reviewer.generate(
        this.reviewerPrompt(input, explanation, activeDecision, {
          teacherContent,
          guardianContent,
          teacherFeedback,
          managementSummary,
        }),
        { structuredOutput: { schema: ReviewerSchema } },
      );
      review = {
        approved: assessment.object.approved,
        note: assessment.object.note,
      };
    } catch (error) {
      this.logger.warn(`Communication reviewer failed; skipping: ${String(error)}`);
    }

    return {
      explanation,
      decision: activeDecision,
      council,
      teacherContent,
      guardianContent,
      teacherFeedback,
      managementSummary,
      review,
    };
  }

  private async runCouncil(input: CommunicationWorkflowInput): Promise<CouncilOutcome> {
    const [a, b] = await Promise.all([
      this.safeStructured<CouncilVerdict>(
        'council auditor A',
        () =>
          this.analysts[0].generate(this.councilPrompt(input), {
            structuredOutput: { schema: CouncilVerdictSchema },
          }).then((r) => r.object),
        {
          flagged: true,
          reason: 'Auditor A could not be reached; keeping the deterministic verdict.',
          confidence: 'MEDIUM',
        },
      ),
      this.safeStructured<CouncilVerdict>(
        'council auditor B',
        () =>
          this.analysts[1].generate(this.councilPrompt(input), {
            structuredOutput: { schema: CouncilVerdictSchema },
          }).then((r) => r.object),
        {
          flagged: true,
          reason: 'Auditor B could not be reached; keeping the deterministic verdict.',
          confidence: 'MEDIUM',
        },
      ),
    ]);

    const bothFlagged = a.flagged && b.flagged;
    const bothClear = !a.flagged && !b.flagged;
    const note = bothFlagged
      ? `Council confirmed the HIGH verdict (both auditors flagged; A: ${a.confidence}, B: ${b.confidence}).`
      : bothClear
        ? `Council disagreed — both auditors cleared the student (A: ${a.reason} | B: ${b.reason}). Downgraded to MEDIUM.`
        : `Council split (A: ${a.flagged ? 'flag' : 'clear'}, B: ${b.flagged ? 'flag' : 'clear'}). Keeping the HIGH verdict.`;

    return {
      consulted: true,
      confirmed: bothFlagged,
      downgraded: bothClear,
      unanimous: bothFlagged || bothClear,
      note,
    };
  }

  private safeStructured<T>(
    label: string,
    generate: () => Promise<T>,
    fallback: T,
  ): Promise<T> {
    return generate().catch((err: unknown) => {
      this.logger.error(
        `[workflow] ${label} generation failed — using deterministic fallback: ${err instanceof Error ? err.message : String(err)}`,
      );
      return fallback;
    });
  }

  private diagnoserPrompt(input: CommunicationWorkflowInput): string {
    const { studentName, studentStats, classStats, criterionStats, weakCriteria, recentGrades } = input;
    return JSON.stringify({
      studentName,
      studentStats,
      classStats,
      criterionStats,
      weakCriteria: weakCriteria.map((c) => ({
        criteriaId: c.criteriaId,
        description: c.description,
        avgPct: c.avgPct,
      })),
      recentGrades,
    });
  }

  private councilPrompt(input: CommunicationWorkflowInput): string {
    const { studentName, studentStats, classStats, criterionStats, weakCriteria } = input;
    return JSON.stringify({
      studentName,
      proposedSeverity: input.decision.severity,
      proposedType: input.decision.type,
      studentStats,
      classStats,
      criterionStats,
      weakCriteria: weakCriteria.map((c) => ({
        description: c.description,
        avgPct: c.avgPct,
      })),
    });
  }

  private teacherAdvisorPrompt(
    input: CommunicationWorkflowInput,
    reason: string,
  ): string {
    const { studentName, studentStats, classStats, criterionStats, recentGrades } = input;
    return JSON.stringify({
      studentName,
      issueType: input.decision.type,
      summary: reason,
      severity: input.decision.severity,
      studentStats,
      classStats,
      criterionStats,
      recentGrades,
    });
  }

  private parentLiaisonPrompt(
    input: CommunicationWorkflowInput,
    reason: string,
  ): string {
    return JSON.stringify({
      studentName: input.studentName,
      summary: reason,
      severity: input.decision.severity,
    });
  }

  private peerCoachPrompt(input: CommunicationWorkflowInput, reason: string): string {
    return JSON.stringify({
      className: input.offeringName ?? 'the class',
      classStats: input.classStats,
      reason,
    });
  }

  private managementAdvisorPrompt(
    input: CommunicationWorkflowInput,
    reason: string,
  ): string {
    return JSON.stringify({
      className: input.offeringName ?? 'the class',
      classStats: input.classStats,
      reason,
    });
  }

  private reviewerPrompt(
    input: CommunicationWorkflowInput,
    explanation: Explanation,
    decision: FlaggedVerdict,
    artifacts: {
      teacherContent: TeacherStudentContent;
      guardianContent: GuardianStudentContent;
      teacherFeedback: TeacherFeedback | null;
      managementSummary: ManagementSummary | null;
    },
  ): string {
    return JSON.stringify({
      verdict: decision,
      explanation,
      teacherContent: artifacts.teacherContent,
      guardianContent: artifacts.guardianContent,
      teacherFeedback: artifacts.teacherFeedback,
      managementSummary: artifacts.managementSummary,
    });
  }

  private buildFallbackExplanation(input: CommunicationWorkflowInput): Explanation {
    const { studentName, decision, studentStats, classStats, criterionStats, weakCriteria } = input;
    const weakest = weakCriteria[0]?.description;
    const head = weakest
      ? `Weakest area: ${weakest}`
      : 'Recent scores are below the class average';
    const highlights = [
      `Average of last ${studentStats.count} graded submissions: ${Math.round(studentStats.last3AvgPct)}%`,
      `Class average: ${Math.round(classStats.classAvgPct)}%`,
    ];
    if (weakCriteria.length > 0) {
      highlights.push(`${weakCriteria[0]?.description} — ${weakCriteria[0]?.avgPct}%`);
    }
    const concerns = weakCriteria
      .slice(0, 4)
      .map((c) => `${c.description} (${c.avgPct}%)`);
    const strengths = criterionStats
      .filter((c) => c.last3AvgPct >= 70)
      .slice(0, 3)
      .map((c) => `${c.criteriaDescription} (${Math.round(c.last3AvgPct)}%)`);
    return {
      reason: `${studentName} is flagged (${decision.type.toLowerCase().replace('_', ' ')}). Over the last ${studentStats.count} graded submissions the average is ${Math.round(studentStats.last3AvgPct)}%, compared with a class average of ${Math.round(classStats.classAvgPct)}%. The pattern indicates the student needs targeted support.`,
      headline: `${studentName} is at risk and needs support`,
      highlights,
      strengths: strengths.length > 0 ? strengths : ['—'],
      concerns:
        concerns.length > 0 ? concerns : ['Overall performance below target'],
      recommendation: `${head}. Assign the recommended practice set and schedule a check-in.`,
    };
  }

  private buildTeacherStudentContent(
    input: CommunicationWorkflowInput,
  ): TeacherStudentContent {
    const { studentName, decision, studentStats, classStats, criterionStats } =
      input;
    const below = criterionStats
      .filter((c) => c.last3AvgPct < 60)
      .slice(0, 3)
      .map((c) => c.criteriaDescription);
    return {
      analysis:
        `**${studentName} is showing a ${decision.type.toLowerCase().replace('_', ' ')} pattern (${Math.round(studentStats.last3AvgPct)}% vs class ${Math.round(classStats.classAvgPct)}%).**\n\n` +
        `### Key numbers\n` +
        `- Average of the last ${studentStats.count} graded submissions: **${Math.round(studentStats.last3AvgPct)}%**\n` +
        `- Class average: **${Math.round(classStats.classAvgPct)}%**\n` +
        (below.length > 0 ? `- Weakest areas: ${below.join(', ')}\n` : '') +
        `\n### Recommended next steps\n` +
        `- Generate the recommended practice set and have the student complete it\n` +
        `- Hold a 1:1 check-in to identify the root cause`,
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
    input: CommunicationWorkflowInput,
  ): GuardianStudentContent {
    return {
      message:
        `**We have observed that ${input.studentName} is having difficulty in ${input.decision.type.toLowerCase().replace('_', ' ')}.**\n\n` +
        `### What you can do at home\n` +
        `- Help your child complete the recommended practice set in Study Lab\n` +
        `- Create a quiet, consistent study schedule this week\n` +
        `- Reach out to the teacher with any questions after the alert`,
      homeSupport: [
        'Help your child complete the recommended practice set in Study Lab',
        'Create a quiet, consistent study schedule this week',
        'Reach out to the teacher with any questions after the alert',
      ],
    };
  }

  private buildTeacherFeedback(
    input: CommunicationWorkflowInput,
  ): TeacherFeedback {
    const className = input.offeringName ?? 'the class';
    return {
      feedback: `**The class average in ${className} is ${Math.round(input.classStats.classAvgPct)}% across ${input.classStats.studentCount} students.**`,
      patternAnalysis: `${input.classStats.belowAverageCount} of ${input.classStats.studentCount} students are below target.`,
      strategies: [
        'Re-teach the weakest criteria to the whole class',
        'Use retrieval practice in the next two sessions',
        'Pair stronger students with those who need support',
      ],
    };
  }

  private buildManagementSummary(
    input: CommunicationWorkflowInput,
  ): ManagementSummary {
    const className = input.offeringName ?? 'the class';
    return {
      summary: `**Class ${className} is averaging ${Math.round(input.classStats.classAvgPct)}% with ${input.classStats.belowAverageCount} of ${input.classStats.studentCount} students below target.**`,
      classTrend: 'The class needs structured intervention this term.',
      recommendation:
        'Monitor the next assessment and provide targeted support for the weakest criteria.',
    };
  }
}
