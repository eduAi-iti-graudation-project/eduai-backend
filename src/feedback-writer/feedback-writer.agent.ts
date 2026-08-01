import { Agent } from '@mastra/core/agent';
import type { Tool } from '@mastra/core/tools';
import type { z } from 'zod';

export const createFeedbackWriterAgent = (
  writeFeedbackTool: Tool<
    z.ZodTypeAny,
    z.ZodTypeAny,
    { feedback: string },
    unknown
  >,
) =>
  new Agent({
    id: 'feedback-writer',
    name: 'Feedback Writer',
    instructions: `You write per-criterion feedback for student submissions.
Use the write-feedback tool to generate specific, actionable feedback for each rubric criterion.`,
    model: 'openai/gpt-5.5',
    tools: { writeFeedback: writeFeedbackTool },
  });
