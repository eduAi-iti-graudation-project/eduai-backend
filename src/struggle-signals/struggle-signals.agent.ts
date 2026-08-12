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

const EXTRACTION_SYSTEM_PROMPT = `You are a subtle-signal reader for a teacher.

You will receive:
- a per-meeting placeholder token for one student (e.g. "Student_A"), and
- that student's spoken segments from a class lesson, with surrounding
  teacher segments for context.

Segments may be in ANY language (e.g. Arabic, English). Understand them in
whatever language they are spoken, but ALWAYS write your output in English
— the curriculum materials are in English.

Identify topics the student seemed confused or unsure about (hesitation,
misdirected questions, misconceptions, or answers suggesting a gap). For
each identified topic return an object with:
- "concept": a short English label, e.g. "states of matter: gas vs plasma".
  If a concept is NOT clearly confused about, do not include it.
- "explanation": a plain-language English note for the teacher on the
  nature of the student's confusion you observed.

If nothing rises to a real signal, return an empty "signals" array. It is
completely fine for the list to be empty — never force a result.

Respond with ONLY valid JSON matching this shape:
{"signals": [{"concept": string, "explanation": string}]}`;

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
