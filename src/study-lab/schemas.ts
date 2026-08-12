import { z } from 'zod';

export const PodcastScriptSchema = z.object({
  title: z.string(),
  description: z.string(),
  segments: z
    .array(
      z.object({
        speaker: z.enum(['HOST', 'GUEST']),
        text: z.string().min(20).max(700),
      }),
    )
    .min(4)
    .max(20),
});

const SlideSchema = z
  .object({
    title: z.string(),
    bullets: z.array(z.string()).min(1).max(6),
    code: z.string().optional(),
    code_snippet: z.string().optional(),
    speakerNote: z.string().optional(),
    speaker_note: z.string().optional(),
    note: z.string().optional(),
  })
  .transform((s) => ({
    title: s.title,
    bullets: s.bullets,
    code: s.code ?? s.code_snippet,
    speakerNote: s.speakerNote ?? s.speaker_note ?? s.note,
  }));

export const DeckSchema = z
  .union([
    z.object({
      title: z.string().optional().default('Lecture Slides'),
      slides: z.array(SlideSchema).min(3).max(14),
    }),
    z
      .array(SlideSchema)
      .min(3)
      .max(14)
      .transform((slides) => ({ slides })),
  ])
  .transform((d) => ({
    title: 'title' in d && d.title ? d.title : 'Lecture Slides',
    slides: d.slides,
  }));

const GuideSectionSchema = z
  .object({
    heading: z.string().optional(),
    title: z.string().optional(),
    content: z.string().min(40),
  })
  .transform((s) => ({
    heading: s.heading ?? s.title ?? '',
    content: s.content,
  }));

export const StudyGuideSchema = z
  .object({
    title: z.string().optional().default('Study Guide'),
    summary: z.string(),
    sections: z.array(GuideSectionSchema).min(3).max(10),
  })
  .transform((g) => ({
    title: g.title,
    summary: g.summary,
    sections: g.sections.map((s) => ({
      heading: s.heading,
      content: s.content,
    })),
  }));

export const FlashcardSchema = z.object({
  front: z.string().min(5).max(200),
  back: z.string().min(5).max(300),
});

export const FlashcardsSchema = z.object({
  title: z.string().optional().default('Flashcards'),
  cards: z.array(FlashcardSchema).min(5).max(30),
});

const PracticeQuestionSchema = z
  .object({
    question: z.string(),
    options: z.array(z.string()).length(4),
    answerIndex: z.number().int().min(0).max(3).optional(),
    answer_index: z.number().int().min(0).max(3).optional(),
    explanation: z.string(),
  })
  .transform((q) => ({
    question: q.question,
    options: q.options,
    answerIndex: q.answerIndex ?? q.answer_index ?? 0,
    explanation: q.explanation,
  }));

export const PracticeSetSchema = z.object({
  title: z.string().optional().default('Practice Questions'),
  questions: z.array(PracticeQuestionSchema).min(4).max(10),
});

const CheatSectionSchema = z
  .object({
    heading: z.string().optional(),
    title: z.string().optional(),
    bullets: z.array(z.string()).min(2).max(8),
  })
  .transform((s) => ({
    heading: s.heading ?? s.title ?? '',
    bullets: s.bullets,
  }));

export const CheatSheetSchema = z
  .object({
    title: z.string().optional().default('Cheat Sheet'),
    sections: z.array(CheatSectionSchema).min(3).max(12),
  })
  .transform((c) => ({
    title: c.title,
    sections: c.sections.map((s) => ({
      heading: s.heading,
      bullets: s.bullets,
    })),
  }));

export type PodcastScript = z.infer<typeof PodcastScriptSchema>;
export type Deck = z.infer<typeof DeckSchema>;
export type StudyGuide = z.infer<typeof StudyGuideSchema>;
export type Flashcards = z.infer<typeof FlashcardsSchema>;
export type PracticeSet = z.infer<typeof PracticeSetSchema>;
export type CheatSheet = z.infer<typeof CheatSheetSchema>;
