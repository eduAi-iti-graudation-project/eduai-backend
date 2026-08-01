import { z } from 'zod';
import { LlmService } from '../../../common/llm/llm.service';
import { QuestionTypeEnum } from '../../dto';

const GeneratedQuestionSchema = z.object({
  type: QuestionTypeEnum,
  question: z.string().min(1),
  options: z
    .array(
      z.object({
        text: z.string(),
        isCorrect: z.boolean().default(false),
      }),
    )
    .nullish(),
  points: z.number().int().min(1).default(1),
  order: z.number().int().min(0),
  correctAnswer: z.string().min(1),
  topic: z.string().nullish(),
});

export const GenerateQuestionsInputSchema = z.object({
  context: z.string(),
  types: z.array(QuestionTypeEnum).nullish(),
  count: z.number().int().min(1).max(20).default(5),
  topic: z.string().nullish(),
  avoidTopics: z.array(z.string()).nullish(),
});

export const GenerateQuestionsOutputSchema = z.object({
  questions: z.array(GeneratedQuestionSchema),
});

export type GenerateQuestionsInput = z.infer<
  typeof GenerateQuestionsInputSchema
>;

const systemPrompt = `You are a quiz question generator for an educator. Given curriculum context, create questions that test understanding.

For MCQ questions:
- Include an options array with EXACTLY 4 items, one of which has isCorrect: true
- Each option must have "text" and "isCorrect" fields

For TRUE_FALSE questions:
- Include an options array with 2 items: one with isCorrect: true, one with isCorrect: false

For SHORT_ANSWER and ESSAY questions:
- Do NOT include options array
- Include a clear correctAnswer that covers the key points

Grounding:
- Base every question ONLY on the provided curriculum context. Never use outside knowledge.
- If the context says no material was found, return an empty questions array ([]).

Return valid JSON with EXACTLY these fields:
{
  "questions": [
    {
      "type": "MCQ|TRUE_FALSE|SHORT_ANSWER|ESSAY",
      "question": "string",
      "options": [{"text": "string", "isCorrect": boolean}] | null,
      "points": 1,
      "order": 0,
      "correctAnswer": "string",
      "topic": "string | null"
    }
  ]
}

Do not omit any fields. MCQ and TRUE_FALSE must always include options.`;

export function createGenerateQuestionsTool(llmService: LlmService) {
  return {
    inputSchema: GenerateQuestionsInputSchema,
    outputSchema: GenerateQuestionsOutputSchema,
    execute: async (
      input: GenerateQuestionsInput,
    ): Promise<z.infer<typeof GenerateQuestionsOutputSchema>> => {
      const types = input.types ?? ['MCQ', 'SHORT_ANSWER'];
      const prompt = [
        `Topic: ${input.topic ?? 'General'}`,
        `Number of questions: ${input.count}`,
        `Question types: ${types.join(', ')}`,
        input.avoidTopics?.length
          ? `Avoid these topics: ${input.avoidTopics.join(', ')}`
          : null,
        '',
        'Curriculum context:',
        input.context,
      ]
        .filter(Boolean)
        .join('\n');

      return llmService.generateStructured({
        systemPrompt,
        userPrompt: prompt,
        schema: GenerateQuestionsOutputSchema,
      });
    },
  };
}
