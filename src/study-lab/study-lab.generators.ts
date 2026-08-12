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
} from './schemas';
import type {
  CheatSheet,
  Deck,
  Flashcards,
  PodcastScript,
  PracticeSet,
  StudyGuide,
} from './schemas';

const GROUNDING_RULES = `
Grounding rules (strict):
- Base ALL content ONLY on the provided curriculum chunks. Never invent facts, dates, formulas, or definitions not present in the chunks.
- If the chunks are empty or clearly irrelevant, say so honestly in the output and keep the content minimal rather than hallucinating.
- Write for an undergraduate student studying for an exam on this topic.
- Output strict JSON only — no markdown fences, no commentary outside the JSON.`;

@Injectable()
export class StudyLabGenerators {
  private readonly logger = new Logger(StudyLabGenerators.name);

  constructor(
    private readonly llmService: LlmService,
    private readonly materialsService: MaterialsService,
  ) {}

  async ground(courseOfferingId: string, topic: string, topK = 12) {
    const chunks = await this.materialsService.searchChunks(
      courseOfferingId,
      topic,
      topK,
    );
    const sources = [...new Set(chunks.map((c) => c.materialTitle))];
    const corpus = chunks
      .map((c, i) => `[chunk ${i + 1}] ${c.content}`)
      .join('\n\n');
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

  async deck(courseOfferingId: string, topic: string): Promise<Deck> {
    const { corpus, sources } = await this.ground(courseOfferingId, topic);

    const systemPrompt = `
You are a course designer. Create a concise slide deck for a university lecture on the given topic.

DECK RULES:
- 3 to 14 slides.
- Each slide: a short title, 2-6 tight bullets (one idea each, exam-ready phrasing), optionally a short code snippet or a one-line speaker note.
- Slide 1 is the title slide (bullets optional, e.g. course context). End with a summary slide of key takeaways.
- Bullets must be self-contained when read on a slide.

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
