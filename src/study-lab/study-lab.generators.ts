import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../common/llm/llm.service';
import { MaterialsService } from '../materials/materials.service';
import {
  CheatSheetSchema,
  DeckSchema,
  FlashcardsSchema,
  PodcastScriptSchema,
  PracticeSetSchema,
  StudyGuideSchema,
  resolveTheme,
} from './schemas';
import type {
  CheatSheet,
  Deck,
  Flashcards,
  PodcastScript,
  PracticeSet,
  StudyGuide,
} from './schemas';
import type { GenerateStudyTheme } from './dto';

const GROUNDING_RULES = `
Grounding rules (strict):
- Base ALL content ONLY on the provided curriculum chunks. Never invent facts, dates, formulas, or definitions not present in the chunks.
- If the chunks are empty or clearly irrelevant, say so honestly in the output and keep the content minimal rather than hallucinating.
- Write for an undergraduate student studying for an exam on this topic.
- Output strict JSON only — no markdown fences, no commentary outside the JSON.
- The JSON must be a single top-level object with no wrapper key: never nest it under keys like "result", "data", "podcast", "script", or "output".`;

const PODCAST_OUTPUT_CONTRACT = `
OUTPUT CONTRACT (strict):
- Respond with exactly one JSON object and nothing else. The top-level keys are exactly:
{
  "title": "short episode title",
  "description": "one-line episode description",
  "segments": [
    { "speaker": "HOST", "text": "first spoken turn" },
    { "speaker": "GUEST", "text": "second spoken turn" }
  ]
}
- "segments" MUST be a JSON array of 4 to 20 objects, each with exactly "speaker" ("HOST" or "GUEST", alternating, starting with HOST) and "text" (2-5 sentences, no stage directions).
- Do not omit, rename, or wrap "segments" — it is required at the top level.`;

@Injectable()
export class StudyLabGenerators {
  private readonly logger = new Logger(StudyLabGenerators.name);

  constructor(
    private readonly llmService: LlmService,
    private readonly materialsService: MaterialsService,
  ) {}

  async ground(courseOfferingId: string, topic: string, topK = 12) {
    let chunks: {
      id: string;
      content: string;
      materialTitle: string;
    }[] = [];
    let embedFailed = false;

    try {
      chunks = await this.materialsService.searchChunks(
        courseOfferingId,
        topic,
        topK,
      );
    } catch (err) {
      embedFailed = true;
      this.logger.warn(
        `[study-lab] embedding/search failed for "${topic}" — falling back to ungrounded generation: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    const sources = [...new Set(chunks.map((c) => c.materialTitle))];
    let corpus = chunks
      .map((c, i) => `[chunk ${i + 1}] ${c.content}`)
      .join('\n\n');

    if (embedFailed || chunks.length < 3) {
      const materials =
        await this.materialsService.listMaterialTitles(courseOfferingId);
      if (materials.length > 0) {
        const titles = materials.map((m) => `- ${m.title}`).join('\n');
        corpus += `
Note on curriculum materials:
The course contains these materials uploaded by the instructor:
${titles}
Use the curriculum chunks above as primary reference. If the requested topic is broad or directly relates to the course subject matter, synthesize a complete, highly educational slide deck covering the topic in detail while aligning closely with the course context. Avoid rejecting the request or returning an empty/stub deck.`;
      }
    }

    return { chunks, sources, corpus };
  }

  async podcastScript(
    courseOfferingId: string,
    topic: string,
    preset: string,
  ): Promise<PodcastScript> {
    const { corpus, sources } = await this.ground(courseOfferingId, topic);
    const presetGuide: Record<string, string> = {
      OVERVIEW:
        'A friendly high-level tour: what the topic is, why it matters, and the core ideas.',
      DEEP_DIVE:
        'An in-depth lecture-style episode covering mechanisms, steps, and nuances.',
      EXAM_CRAM:
        'Fast-paced revision episode hitting the must-know facts, formulas, and common exam traps.',
      CASUAL:
        'A relaxed study-session chat between two students explaining things to each other.',
      BREAKDOWN:
        'A step-by-step explanation that dissects the topic into small digestible parts.',
    };

    const systemPrompt = `
You are a podcast script writer for an AI study assistant. Write an engaging two-host educational podcast episode script.

PRESET: ${presetGuide[preset] ?? presetGuide.OVERVIEW}

CONVERSATION FORMAT:
- Exactly two speakers: HOST (the knowledgeable tutor, asks questions and summarizes) and GUEST (the relaxed co-host, explains).
- Alternate speakers; start with the HOST. Between 4 and 20 segments total.
- Each segment is one speaker's spoken turn, 2-5 sentences, natural conversational tone, no stage directions, no emojis.
- Include a short title and a one-line description for the episode.

${PODCAST_OUTPUT_CONTRACT}

${GROUNDING_RULES}

Curriculum chunks:
${corpus}`;

    const userPrompt = `Write a podcast episode about: "${topic}".`;

    const script = await this.llmService.generateStructured({
      systemPrompt,
      userPrompt,
      schema: PodcastScriptSchema,
    });

    this.logger.log(
      `[study-lab] podcast script generated: ${script.segments.length} segments (sources: ${sources.join(', ')})`,
    );
    return script;
  }

  async deck(
    courseOfferingId: string,
    topic: string,
    theme?: GenerateStudyTheme,
  ): Promise<Deck> {
    const { corpus, sources } = await this.ground(courseOfferingId, topic);

    // Build theme instructions for the LLM based on user selection
    let themeInstructions = '';
    if (theme) {
      const resolved = resolveTheme({
        preset: theme.preset,
        background: theme.background ?? 'light',
        accent: theme.accent,
        motion: theme.motion ?? 'rise',
      });
      const presetLabel = theme.preset
        ? `"${theme.preset}" preset`
        : 'custom theme';
      themeInstructions = `
THEME INSTRUCTIONS (STRICT — the student chose a specific theme; you MUST honour it):
- Use the ${presetLabel} for this deck's visual identity.
- Set theme.background = "${resolved.background}".
- Set theme.accent = "${resolved.colors.accent}" (this is the brand accent used throughout).
- Set theme.motion = "${resolved.motion}".
- Set theme.preset = "${resolved.preset ?? theme.preset ?? 'modern'}".
- Keep these values consistent in EVERY slide — do not change the accent mid-deck.`;
    } else {
      themeInstructions = `
THEME INSTRUCTIONS:
- Choose a theme.background ("light" | "dark" | "gradient"), a single theme.accent (#RRGGBB) that fits the topic, and theme.motion ("fade" | "rise" | "slide" | "scale").
- Keep these values consistent in EVERY slide.`;
    }

    const systemPrompt = `
You are a presentation designer for a premium AI study assistant. Design a polished, comprehensive, lecture-quality slide deck for the given topic.

DECK RULES (STRICT):
- Generate between 8 and 14 slides (aim for 10-12 slides). DO NOT generate a short 3-5 slide deck.
- Include a "theme" object at the top level with: background, accent, motion, and optionally preset.
- Slide 1 uses layout "title" (title on an accent background; keep it short). End with layout "summary" (key takeaways as a list block).
- Every slide must feel rich and informative: include an "eyebrow" kicker, a clear "title", and 3-6 content blocks (paragraphs, detailed lists, stat callouts, quotes, key columns).
- Use blocks, never free-form markdown:
  - heading: an intra-slide section heading (level h1-h3).
  - paragraph: one concise sentence or two of explanation.
  - list: 3-6 tight bullets (one idea each, detailed exam-ready phrasing).
  - quote: a definition or key statement worth calling out (attribution optional).
  - callout: an exam-critical idea, with tone "info" | "tip" | "warn".
  - code: a short snippet (language optional).
  - stat: a big number + short label (e.g. "9.8 m/s²" "acceleration due to gravity").
  - columns: a 2-3 column comparison (heading + items per column).
- Layout guidance:
  - "statement": one bold idea, centered, minimal blocks — use for a memorable takeaway or definition.
  - "split": text blocks on the left, a visual on the right (add the "visual" field).
  - "bullets": the default teaching slide with comprehensive explanations.
- DESIGN SYSTEM: one accent color per deck (consistent across slides), generous whitespace, rich educational value per slide. Vary block types for visual rhythm.
- Keep text plain — no markdown, no **, no *italics*, no bullet characters like "-" or "•" inside block text.

${themeInstructions}

VISUAL RULES (optional, high value):
- Some slides may include a "visual" field rendered as a diagram. Only attach a visual when the curriculum genuinely supports it — never force one.
- Choose the visual type that matches the content:
  - numeric/measurable data → chart: { kind: "bar"|"line"|"pie"|"area", categories: [...], series: [{ label, values: [...] }] }
  - a sequence of steps or a process → flow: { kind: "flow", steps: [{ label, detail? }] }
  - chronological events or dates → timeline: { kind: "timeline", events: [{ label, detail? }] }
  - a side-by-side contrast (pros/cons, then/now, X vs Y) → comparison: { kind: "comparison", leftTitle, rightTitle, rows: [{ left, right }] }
  - a set of related concepts and their connections → concept_map: { kind: "concept_map", nodes: [{ id, label }], edges: [{ from, to, label? }] }
- Limits: charts ≤ 8 categories and ≤ 3 series; flow/timeline ≤ 8 steps or events; comparison ≤ 6 rows; concept maps ≤ 8 nodes and ≤ 12 edges.
- CRITICAL: every number, label, and connection in a visual MUST come directly from the curriculum chunks. Never invent data, values, or dates to fill a visual. If the chunks do not support a visual, omit it.
- The visual should complement the text blocks, not repeat them word for word.
- Keep chart values small and simple; label axes for bar/line/area charts.

${GROUNDING_RULES}

Curriculum chunks:
${corpus}`;

    const userPrompt = `Create the slide deck for: "${topic}".`;

    const deck = await this.llmService.generateStructured({
      systemPrompt,
      userPrompt,
      schema: DeckSchema,
    });

    this.logger.log(
      `[study-lab] deck generated: ${deck.slides.length} slides (sources: ${sources.join(', ')})`,
    );
    return deck;
  }

  async studyGuide(
    courseOfferingId: string,
    topic: string,
  ): Promise<StudyGuide> {
    const { corpus, sources } = await this.ground(courseOfferingId, topic);

    const systemPrompt = `
You are a study-notes writer. Produce a structured study guide for the given topic.

GUIDE RULES:
- 3 to 10 sections with clear headings (e.g. Definitions, Key Concepts, Processes, Formulas, Common Mistakes).
- Each section: 3-8 sentences of dense, accurate notes written as connected prose.
- Include a 2-3 sentence summary at the top.
- Call out formulas and definitions explicitly when the chunks contain them.

${GROUNDING_RULES}

Curriculum chunks:
${corpus}`;

    const userPrompt = `Write the study guide for: "${topic}".`;

    const guide = await this.llmService.generateStructured({
      systemPrompt,
      userPrompt,
      schema: StudyGuideSchema,
    });

    this.logger.log(
      `[study-lab] study guide generated: ${guide.sections.length} sections (sources: ${sources.join(', ')})`,
    );
    return guide;
  }

  async flashcards(
    courseOfferingId: string,
    topic: string,
  ): Promise<Flashcards> {
    const { corpus, sources } = await this.ground(courseOfferingId, topic);

    const systemPrompt = `
You are an exam-prep tutor. Create flashcards for spaced repetition on the given topic.

CARD RULES:
- 5 to 30 cards.
- Front: a crisp question or term prompt (max ~20 words).
- Back: the concise answer or definition (max ~40 words), accurate to the curriculum.
- Cover the most testable facts, definitions, formulas, and distinctions in the chunks.

${GROUNDING_RULES}

Curriculum chunks:
${corpus}`;

    const userPrompt = `Create flashcards for: "${topic}".`;

    const cards = await this.llmService.generateStructured({
      systemPrompt,
      userPrompt,
      schema: FlashcardsSchema,
    });

    this.logger.log(
      `[study-lab] flashcards generated: ${cards.cards.length} cards (sources: ${sources.join(', ')})`,
    );
    return cards;
  }

  async practiceSet(
    courseOfferingId: string,
    topic: string,
  ): Promise<PracticeSet> {
    const { corpus, sources } = await this.ground(courseOfferingId, topic);
    const grounded = corpus.trim().length > 0;

    const systemPrompt = grounded
      ? `
You are an exam writer. Create a multiple-choice practice set on the given topic.

QUESTION RULES:
- 4 to 10 questions, each with exactly 4 options and exactly one correct answerIndex (0-3).
- Mix recall, application, and reasoning questions.
- Each question needs a 1-3 sentence explanation of why the correct answer is right (grounded in the chunks).
- Distractors must be plausible but clearly wrong given the curriculum.

${GROUNDING_RULES}

Curriculum chunks:
${corpus}`
      : `
You are an exam writer. Create a multiple-choice practice set on the given topic using your own general knowledge of the subject.

QUESTION RULES:
- 4 to 10 questions, each with exactly 4 options and exactly one correct answerIndex (0-3).
- Mix recall, application, and reasoning questions.
- Each question needs a 1-3 sentence explanation of why the correct answer is right.
- Distractors must be plausible but clearly wrong.
- No curriculum chunks were available for this topic, so answer from general subject knowledge — do not refuse.

Output strict JSON only — no markdown fences, no commentary outside the JSON.`;

    const userPrompt = `Create the practice set for: "${topic}".`;

    const set = await this.llmService.generateStructured({
      systemPrompt,
      userPrompt,
      schema: PracticeSetSchema,
    });

    this.logger.log(
      `[study-lab] practice set generated: ${set.questions.length} questions (sources: ${sources.join(', ')})`,
    );
    return set;
  }

  async cheatSheet(
    courseOfferingId: string,
    topic: string,
  ): Promise<CheatSheet> {
    const { corpus, sources } = await this.ground(courseOfferingId, topic);

    const systemPrompt = `
You are a revision-sheet designer. Build a one-page cheat sheet for the given topic.

CHEAT SHEET RULES:
- 3 to 12 compact sections (e.g. Key Definitions, Formulas, Steps, Edge Cases, Mnemonics).
- Each section has 2-8 one-line bullets — telegraphic, dense, exam-ready. No long prose.
- Prioritize the information most likely to be on an exam.

${GROUNDING_RULES}

Curriculum chunks:
${corpus}`;

    const userPrompt = `Create the cheat sheet for: "${topic}".`;

    const sheet = await this.llmService.generateStructured({
      systemPrompt,
      userPrompt,
      schema: CheatSheetSchema,
    });

    this.logger.log(
      `[study-lab] cheat sheet generated: ${sheet.sections.length} sections (sources: ${sources.join(', ')})`,
    );
    return sheet;
  }
}
