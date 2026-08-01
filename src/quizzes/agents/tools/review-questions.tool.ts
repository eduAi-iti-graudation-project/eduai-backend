import { z } from 'zod';
import { LlmService } from '../../../common/llm/llm.service';
import { QuestionTypeEnum } from '../../dto';

const ReviewQuestionSchema = z.object({
  type: QuestionTypeEnum,
  question: z.string(),
  topic: z.string().nullish(),
});

export const ReviewQuestionsInputSchema = z.object({
  questions: z.array(ReviewQuestionSchema),
  context: z.string(),
});

export const ReviewQuestionsOutputSchema = z.object({
  coverage: z.string(),
  gaps: z.array(z.string()),
  balanced: z.boolean(),
  suggestion: z.string().optional(),
});

export type ReviewQuestionsInput = z.infer<typeof ReviewQuestionsInputSchema>;

const systemPrompt = `You are a quiz reviewer. Given a set of questions and the curriculum context, evaluate:

1. Coverage: what topics from the context are covered by the questions?
2. Gaps: what important topics from the context are NOT covered?
3. Balance: does the question set have a good mix of types and difficulty?

Return valid JSON with EXACTLY these fields:
{
  "coverage": "string describing what's covered",
  "gaps": ["string array of missing topics"],
  "balanced": true | false,
  "suggestion": "string describing what to generate next to fill gaps" | null
}

Do not omit any fields.`;

export function createReviewQuestionsTool(llmService: LlmService) {
  return {
    inputSchema: ReviewQuestionsInputSchema,
    outputSchema: ReviewQuestionsOutputSchema,
    execute: async (
      input: ReviewQuestionsInput,
    ): Promise<z.infer<typeof ReviewQuestionsOutputSchema>> => {
      const prompt = [
        'Curriculum context:',
        input.context,
        '',
        'Generated questions:',
        ...input.questions.map(
          (q, i) =>
            `${i + 1}. [${q.type}] ${q.question}${q.topic ? ` (topic: ${q.topic})` : ''}`,
        ),
      ].join('\n');

      return llmService.generateStructured({
        systemPrompt,
        userPrompt: prompt,
        schema: ReviewQuestionsOutputSchema,
      });
    },
  };
}
