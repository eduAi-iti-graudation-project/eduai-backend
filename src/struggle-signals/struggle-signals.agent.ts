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

export const EXTRACTION_SYSTEM_PROMPT = `You are an educational AI analyzing a class meeting transcript. Your job is to detect ONLY the concepts or topics that the STUDENT appeared confused about, asked about, or needed clarification on.

Rules:
- ONLY flag concepts the STUDENT explicitly questioned or struggled with (e.g. "ايه هي الميكانيكا؟", "مش فاهم الخلية", "what is mechanics?").
- IGNORE: teacher explanations, casual conversation, greetings, filler words, general discussion, teacher questions, admin talk.
- IGNORE: anything that is not clearly a gap in the student's understanding.
- If there are no genuine confusion signals, return {"signals": []} — do NOT invent topics.
- Extract at most 3–5 concepts. Quality over quantity.
- Write concept names clearly in English (with Arabic in parentheses if needed), e.g. "Mechanics (الميكانيكا)".
- The explanation should describe WHY this concept needs follow-up based on what the student said.

Return ONLY valid JSON in this exact shape — no markdown, no extra text:
{
  "signals": [
    {
      "concept": "Mechanics (الميكانيكا)",
      "explanation": "Student asked 'ايه هي الميكانيكا' indicating they need a foundational explanation of mechanics."
    }
  ]
}`;

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
