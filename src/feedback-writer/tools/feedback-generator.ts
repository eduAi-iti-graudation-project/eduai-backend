import { z } from 'zod';
import { LlmService } from '../../common/llm/llm.service';
import { FORMATTING_RULES } from '../../common/llm/formatting-rules';

export const FeedbackSchema = z.object({
  feedback: z
    .string()
    .describe(
      'Specific, actionable feedback explaining why the student received this score and how to improve.',
    ),
});

export interface WriteFeedbackInput {
  criterionDescription: string;
  maxPoints: number;
  pointsAwarded: number;
  submissionContent: string;
}

export async function generateFeedback(
  llmService: LlmService,
  input: WriteFeedbackInput,
): Promise<{ feedback: string }> {
  const { criterionDescription, maxPoints, pointsAwarded, submissionContent } =
    input;

  const result = await llmService.generateStructured({
    systemPrompt:
      `You are a helpful teaching assistant providing feedback on student work.
Write specific, actionable feedback for a single rubric criterion.

Given:
- Criterion description: ${criterionDescription}
- Maximum points: ${maxPoints}
- Points awarded: ${pointsAwarded}
- Ratio: ${Math.round((pointsAwarded / maxPoints) * 100)}%

Return valid JSON matching this schema:
{ "feedback": "string — 2-4 sentences of specific, actionable feedback explaining why the student received this score and how to improve." }

Guidelines:
1. Explain why the student received this score
2. Reference specific parts of their submission
3. Suggest concrete improvements
4. Be encouraging but honest
5. Keep feedback to 2-4 sentences
` + FORMATTING_RULES,
    userPrompt: `Student submission:\n${submissionContent.slice(0, 3000)}`,
    schema: FeedbackSchema,
  });

  return { feedback: result.feedback };
}
