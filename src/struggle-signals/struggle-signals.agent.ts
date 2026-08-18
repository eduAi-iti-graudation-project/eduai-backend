import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import {
  createGatewayLanguageModel,
  type GatewayChat,
} from './gateway-language-model';

/** Zod schema for the per-student extraction call. Empty list is valid. */
export const SignalExtractionOutputSchema = z.object({
  signals: z
    .array(
      z.object({
        concept: z.string().min(1).max(200),
        explanation: z.string().min(1).max(1000),
      }),
    )
    .max(10),
});

export const EXTRACTION_SYSTEM_PROMPT = `You are an educational AI analyzing a meeting transcript to extract key concepts, questions, or topics discussed that require follow-up.

You will receive spoken transcript lines from a class meeting (in Arabic or English).

Identify key topics, questions, or concepts mentioned in the transcript that students need follow-up on (e.g. questions like "ايه هي الميكانيكا", "ايه هي الخليه", "what is mechanics").

For each identified topic, return JSON in this exact shape:
{
  "signals": [
    {
      "concept": "Mechanics (الميكانيكا)",
      "explanation": "Question/discussion regarding the core concepts of mechanics."
    }
  ]
}

Write concepts clearly. Respond ONLY with valid JSON. Do not include markdown codeblocks or conversational text.`;

export function buildExtractionPrompt(input: {
  courseName: string;
  studentToken: string;
  studentSegments: { timestamp: number; text: string }[];
  teacherSegments: { timestamp: number; text: string }[];
}): string {
  const lines: string[] = [
    `Course lesson: ${input.courseName}`,
    `Target student: ${input.studentToken}`,
    '',
    'The student said:',
    ...input.studentSegments.map(
      (s) => `[t=${s.timestamp}s] ${input.studentToken}: ${s.text}`,
    ),
  ];
  if (input.teacherSegments.length > 0) {
    lines.push(
      '',
      'Nearby teacher context:',
      ...input.teacherSegments.map(
        (s) => `[t=${s.timestamp}s] Teacher: ${s.text}`,
      ),
    );
  }
  return lines.join('\n');
}

/**
 * The struggle-signal extractor as a REAL executed Mastra agent
 * (`createStruggleSignalExtractor` is invoked by the service, which then
 * calls `agent.generate(..., { structuredOutput: { schema } })` per student).
 * The upstream provider is the ITI gateway (not OpenAI-compatible), so the
 * agent's `model` is the in-house `LanguageModelV2` adapter over
 * `ProviderService.chat` rather than a model id.
 */
export const createStruggleSignalExtractor = (chat: GatewayChat) =>
  new Agent({
    id: 'struggle-signal-extractor',
    name: 'Struggle Signal Extractor',
    instructions: EXTRACTION_SYSTEM_PROMPT,
    model: createGatewayLanguageModel(chat),
    tools: {},
  });

export type StruggleSignalExtractor = ReturnType<
  typeof createStruggleSignalExtractor
>;
