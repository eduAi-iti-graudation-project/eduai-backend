import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';
import { GradingOutputSchema } from './dto';

const MAX_SUBMISSION_CHARS = 12000;

export interface GradedCriterion {
  criterionId: string;
  pointsAwarded: number;
  feedback: string;
}

export interface GradingResult {
  scores: GradedCriterion[];
  overallFeedback?: string;
}

interface CriterionContext {
  id: string;
  description: string;
  maxPoints: number;
}

const SYSTEM_PROMPT = `You are a meticulous grading agent for a teacher. Grade a student's submission against the rubric criteria provided.

Return ONLY valid JSON matching this schema:
{
  "scores": [
    {
      "criterionId": "exact criterion uuid",
      "pointsAwarded": integer between 0 and that criterion's maxPoints,
      "feedback": "2-4 sentences: what the student did, evidence from the submission, and how to improve"
    }
  ],
  "overallFeedback": "optional 1-2 sentence summary"
}

Rules:
1. Score EVERY criterion exactly once, using the exact criterionId values provided.
2. pointsAwarded must be an integer between 0 and that criterion's maxPoints inclusive.
3. Base scores strictly on evidence in the submission. Never invent or assume content.
4. If a criterion is not addressed at all, award 0 and say the submission provides no evidence for it.`;

function buildUserPrompt(params: {
  assignmentTitle: string;
  assignmentDescription: string | null;
  criteria: CriterionContext[];
  content: string;
}): string {
  const lines = params.criteria.map(
    (c) =>
      `- ${c.description} (max ${c.maxPoints} points) [criterionId: ${c.id}]`,
  );
  return [
    `Assignment: ${params.assignmentTitle}`,
    params.assignmentDescription
      ? `Assignment description: ${params.assignmentDescription}`
      : null,
    '',
    'Rubric criteria:',
    ...lines,
    '',
    'Student submission:',
    params.content || '(empty submission)',
  ]
    .filter((line) => line !== null)
    .join('\n');
}

export function selectSubmissionChunks(
  chunks: string[],
  criteriaDescriptions: string[],
  maxChars = MAX_SUBMISSION_CHARS,
): string {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  if (total <= maxChars || chunks.length <= 1) return chunks.join('\n\n');

  const keywords = extractKeywords(criteriaDescriptions);
  const scored = chunks.map((content, index) => ({
    content,
    index,
    score: keywords.reduce(
      (sum, k) => sum + countOccurrences(content.toLowerCase(), k),
      0,
    ),
  }));
  scored.sort((a, b) => b.score - a.score || a.index - b.index);

  const selected: { content: string; index: number }[] = [];
  let used = 0;
  for (const item of scored) {
    if (used + item.content.length > maxChars) continue;
    selected.push(item);
    used += item.content.length + 2;
  }

  if (selected.length === 0) {
    for (const content of chunks) {
      if (used + content.length > maxChars) break;
      selected.push({ content, index: selected.length });
      used += content.length + 2;
    }
  }

  selected.sort((a, b) => a.index - b.index);
  return selected.map((c) => c.content).join('\n\n');
}

function extractKeywords(texts: string[]): string[] {
  const words = new Set<string>();
  for (const text of texts) {
    for (const word of text.toLowerCase().split(/[^a-z0-9]+/)) {
      if (word.length > 4) words.add(word);
    }
  }
  return [...words];
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count++;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function clampPoints(points: number, maxPoints: number): number {
  return Math.max(0, Math.min(maxPoints, Math.round(points)));
}

@Injectable()
export class GradingAgent {
  private readonly logger = new Logger(GradingAgent.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService,
  ) {}

  async grade(submissionId: string): Promise<GradingResult> {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        assignment: {
          include: {
            rubrics: {
              where: { isConfirmed: true },
              include: { criteria: true },
            },
          },
        },
        chunks: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!submission) {
      throw new Error(`Submission ${submissionId} not found`);
    }

    const criteria = collectCriteria(submission.assignment.rubrics);
    if (criteria.length === 0) {
      return { scores: [] };
    }

    const content = selectSubmissionChunks(
      submission.chunks.map((c) => c.content),
      criteria.map((c) => c.description),
    );

    const result = await this.llmService.generateStructured({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: buildUserPrompt({
        assignmentTitle: submission.assignment.title,
        assignmentDescription: submission.assignment.description,
        criteria,
        content,
      }),
      schema: GradingOutputSchema,
    });

    return normalize(result, criteria);
  }
}

function collectCriteria(
  rubrics: { criteria: CriterionContext[] }[],
): CriterionContext[] {
  const seen = new Set<string>();
  const criteria: CriterionContext[] = [];
  for (const rubric of rubrics) {
    for (const criterion of rubric.criteria) {
      if (seen.has(criterion.id)) continue;
      seen.add(criterion.id);
      criteria.push({
        id: criterion.id,
        description: criterion.description,
        maxPoints: criterion.maxPoints,
      });
    }
  }
  return criteria;
}

function normalize(
  result: {
    scores: { criterionId: string; pointsAwarded: number; feedback: string }[];
    overallFeedback?: string;
  },
  criteria: CriterionContext[],
): GradingResult {
  const byId = new Map(criteria.map((c) => [c.id, c]));
  const scores: GradedCriterion[] = [];

  for (const item of result.scores) {
    const criterion = byId.get(item.criterionId);
    if (!criterion) continue;
    scores.push({
      criterionId: criterion.id,
      pointsAwarded: clampPoints(item.pointsAwarded, criterion.maxPoints),
      feedback: item.feedback,
    });
  }

  const awarded = new Set(scores.map((s) => s.criterionId));
  for (const criterion of criteria) {
    if (awarded.has(criterion.id)) continue;
    scores.push({
      criterionId: criterion.id,
      pointsAwarded: 0,
      feedback: 'No evidence was found in the submission for this criterion.',
    });
  }

  return { scores, overallFeedback: result.overallFeedback };
}
