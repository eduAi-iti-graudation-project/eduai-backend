import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import {
  createGatewayLanguageModel,
  type GatewayChat,
} from '../../struggle-signals/gateway-language-model';

// ─── Per-template config schemas ────────────────────────

/**
 * Drag labeled cards (e.g. organelle cards) into the correct drop region.
 * Optional `tabs` model different cell types / layouts (e.g. Eukaryotic vs
 * Prokaryotic): each tab has its own regions, and every item targets one
 * region of one tab. Win when all items of the ACTIVE tab are placed.
 */
const DragToRegionsSpec = z.object({
  template: z.literal('drag-to-regions'),
  title: z.string().min(1).max(120),
  instructions: z.string().min(1).max(500),
  objective: z.string().min(1).max(200),
  tabs: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1).max(60),
        regions: z
          .array(
            z.object({
              id: z.string().min(1),
              label: z.string().min(1).max(80),
              hint: z.string().max(200).optional(),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1).max(80),
        emoji: z.string().max(8).optional(),
        tabId: z.string().min(1),
        regionId: z.string().min(1),
        fact: z.string().max(300).optional(),
      }),
    )
    .min(1),
});

/** Drag statement/feature cards into the correct category buckets. */
const SortCategoriesSpec = z.object({
  template: z.literal('sort-categories'),
  title: z.string().min(1).max(120),
  instructions: z.string().min(1).max(500),
  objective: z.string().min(1).max(200),
  categories: z
    .array(
      z.object({ id: z.string().min(1), label: z.string().min(1).max(80) }),
    )
    .min(2),
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1).max(140),
        categoryId: z.string().min(1),
      }),
    )
    .min(2),
});

/** Match each term to its definition. */
const MatchPairsSpec = z.object({
  template: z.literal('match-pairs'),
  title: z.string().min(1).max(120),
  instructions: z.string().min(1).max(500),
  objective: z.string().min(1).max(200),
  pairs: z
    .array(
      z.object({
        id: z.string().min(1),
        term: z.string().min(1).max(80),
        definition: z.string().min(1).max(200),
      }),
    )
    .min(2),
});

/** Flip flashcards to review terms and definitions. */
const FlashcardsSpec = z.object({
  template: z.literal('flashcards'),
  title: z.string().min(1).max(120),
  instructions: z.string().min(1).max(500),
  objective: z.string().min(1).max(200),
  cards: z
    .array(
      z.object({
        id: z.string().min(1),
        front: z.string().min(1).max(80),
        back: z.string().min(1).max(300),
      }),
    )
    .min(1),
});

/** The architect's structured output: pick a template and fill it with content. */
export const LabGameSpecSchema = z.discriminatedUnion('template', [
  DragToRegionsSpec,
  SortCategoriesSpec,
  MatchPairsSpec,
  FlashcardsSpec,
]);

export type LabGameSpec = z.infer<typeof LabGameSpecSchema>;

// ─── Prompt ─────────────────────────────────────────────

const TEMPLATE_CATALOG = `Pick the template that best fits the teacher's request, and fill it ONLY with content taken from the provided curriculum context. Never invent facts, values, or labels that are not present in the context.

Available templates:

1. drag-to-regions — drag labeled cards into the correct drop regions.
   Use for "place X in the right place", "construct", "build a ...", "label the parts", "put each item where it belongs".
   {
     "template": "drag-to-regions",
     "title": "short title",
     "instructions": "one or two sentences telling the student what to do",
     "objective": "one sentence describing the win condition (shown on screen)",
     "tabs": [
       {
         "id": "eukaryotic",
         "label": "Eukaryotic cell",
         "regions": [{ "id": "nucleus", "label": "Nucleus", "hint": "optional hint" }]
       }
     ],
     "items": [
       { "id": "nucleus-1", "label": "Nucleus", "emoji": "🔵", "tabId": "eukaryotic", "regionId": "nucleus", "fact": "optional short fact shown when placed" }
     ]
   }
   For a "prokaryotic vs eukaryotic" lab, use two tabs whose regions differ (e.g. the prokaryotic tab has no nucleus region).

2. sort-categories — drag statement cards into the correct category buckets.
   Use for "classify", "sort", "which of these is ...".
   {
     "template": "sort-categories",
     "title": "short title",
     "instructions": "one or two sentences telling the student what to do",
     "objective": "one sentence describing the win condition",
     "categories": [{ "id": "prokaryotic", "label": "Prokaryotic" }],
     "items": [{ "id": "i1", "label": "No membrane-bound nucleus", "categoryId": "prokaryotic" }]
   }

3. match-pairs — match each term to its definition.
   Use for "match", "pair", "connect each term with its meaning".
   {
     "template": "match-pairs",
     "title": "short title",
     "instructions": "one or two sentences telling the student what to do",
     "objective": "one sentence describing the win condition",
     "pairs": [{ "id": "p1", "term": "Nucleus", "definition": "Stores genetic material and controls cell activities" }]
   }

4. flashcards — flip cards to review terms and definitions.
   Use for "review", "study", "memorize".
   {
     "template": "flashcards",
     "title": "short title",
     "instructions": "one or two sentences telling the student what to do",
     "objective": "one sentence describing the win condition",
     "cards": [{ "id": "c1", "front": "Nucleus", "back": "Stores genetic material and controls cell activities" }]
   }

Rules:
- Output ONLY the JSON object for the chosen template. No markdown fences, no commentary.
- Every id must be unique and short (a-z0-9 and dashes). Labels may be any text.
- Keep item/definition texts short and readable on screen.
- The content (labels, functions, facts, examples) MUST be taken from the curriculum context — if the context does not cover something the teacher asked for, skip it rather than inventing it.`;

export const ARCHITECT_SYSTEM_PROMPT = `You are a lab game architect for a science teacher. A teacher gives you a prompt and a curriculum excerpt from the chapter they selected. Your job is to design a simple, reliable interactive EXPLANATION game by choosing one of the templates below and filling it with content grounded strictly in the provided curriculum excerpt.

The game is rendered by a fixed engine, so you never write code — you only produce the game's data/spec. The interaction and the win condition are handled by the engine. Your only job is correct, well-chosen content that matches the teacher's intent and the curriculum.

${TEMPLATE_CATALOG}`;

export function buildLabArchitectPrompt(input: {
  topic: string;
  curriculum: string;
  previousSpec?: LabGameSpec;
  instruction?: string;
}): string {
  if (input.previousSpec !== undefined) {
    return `You are MODIFYING an existing lab game. The teacher asked for a specific change. Apply the change to the EXISTING game spec below — keep everything that already works, change only what the request needs. Prefer the same template unless the request clearly needs a different one. Output the COMPLETE updated spec JSON — never a fragment.

REQUESTED CHANGE:
${input.instruction}

EXISTING GAME SPEC:
${JSON.stringify(input.previousSpec)}

Curriculum context (for reference — the existing spec is authoritative):
${input.curriculum}`;
  }
  return `Teacher's request:
${input.topic}

Curriculum context:
${input.curriculum}`;
}

/** The lab architect as a REAL executed Mastra agent. */
export const createLabArchitect = (chat: GatewayChat) =>
  new Agent({
    id: 'lab-architect',
    name: 'Lab Game Architect',
    instructions: ARCHITECT_SYSTEM_PROMPT,
    model: createGatewayLanguageModel(chat),
    tools: {},
  });

export type LabArchitect = ReturnType<typeof createLabArchitect>;
