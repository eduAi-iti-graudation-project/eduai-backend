import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { LlmService } from '../../common/llm/llm.service';
import { generateFeedback, WriteFeedbackInput } from './feedback-generator';

export const WriteFeedbackInputSchema = z.object({
  criterionDescription: z.string().describe('The rubric criterion description'),
  maxPoints: z.number().describe('Maximum points for this criterion'),
  pointsAwarded: z.number().describe('Points the student received'),
  submissionContent: z.string().describe('The student submission text'),
});

export type { WriteFeedbackInput };

export type FeedbackTool = {
  execute: (input: WriteFeedbackInput) => Promise<{ feedback: string }>;
};

export const createWriteFeedbackTool = (llmService: LlmService) =>
  createTool({
    id: 'write-feedback',
    description: 'Write per-criterion feedback for a student submission',
    inputSchema: WriteFeedbackInputSchema,
    outputSchema: z.object({ feedback: z.string() }),
    execute: async (inputData: WriteFeedbackInput) =>
      generateFeedback(llmService, inputData),
  });
