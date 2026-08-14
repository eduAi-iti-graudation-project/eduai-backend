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

export const ChartVisualSchema = z.object({
  kind: z.enum(['bar', 'line', 'pie', 'area']),
  title: z.string().optional(),
  categories: z.array(z.string()).min(2).max(8),
  series: z
    .array(
      z.object({
        label: z.string(),
        values: z.array(z.number()),
      }),
    )
    .min(1)
    .max(3),
  xLabel: z.string().optional(),
  yLabel: z.string().optional(),
});

export const FlowVisualSchema = z.object({
  kind: z.literal('flow'),
  title: z.string().optional(),
  steps: z
    .array(
      z.object({
        label: z.string(),
        detail: z.string().optional(),
      }),
    )
    .min(2)
    .max(8),
});

export const TimelineVisualSchema = z.object({
  kind: z.literal('timeline'),
  title: z.string().optional(),
  events: z
    .array(
      z.object({
        label: z.string(),
        detail: z.string().optional(),
      }),
    )
    .min(2)
    .max(8),
});

export const ComparisonVisualSchema = z.object({
  kind: z.literal('comparison'),
  title: z.string().optional(),
  leftTitle: z.string(),
  rightTitle: z.string(),
  rows: z
    .array(
      z.object({
        left: z.string(),
        right: z.string(),
      }),
    )
    .min(1)
    .max(6),
});

export const ConceptMapVisualSchema = z.object({
  kind: z.literal('concept_map'),
  title: z.string().optional(),
  nodes: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
      }),
    )
    .min(2)
    .max(8),
  edges: z
    .array(
      z.object({
        from: z.string(),
        to: z.string(),
        label: z.string().optional(),
      }),
    )
    .min(1)
    .max(12),
});

export const SlideVisualSchema = z.union([
  ChartVisualSchema,
  FlowVisualSchema,
  TimelineVisualSchema,
  ComparisonVisualSchema,
  ConceptMapVisualSchema,
]);

export type ChartVisual = z.infer<typeof ChartVisualSchema>;
export type FlowVisual = z.infer<typeof FlowVisualSchema>;
export type TimelineVisual = z.infer<typeof TimelineVisualSchema>;
export type ComparisonVisual = z.infer<typeof ComparisonVisualSchema>;
export type ConceptMapVisual = z.infer<typeof ConceptMapVisualSchema>;
export type SlideVisual = z.infer<typeof SlideVisualSchema>;

export const DeckThemeSchema = z.object({
  background: z.enum(['light', 'dark', 'gradient']).default('light'),
  accent: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  motion: z.enum(['fade', 'rise', 'slide', 'scale']).default('rise'),
});

export type DeckTheme = z.infer<typeof DeckThemeSchema>;

export const DEFAULT_DECK_THEME: DeckTheme = {
  background: 'light',
  motion: 'rise',
};

const textish = (max: number) =>
  z
    .object({
      text: z.string().min(1).max(max).optional(),
      content: z.string().min(1).max(max).optional(),
    })
    .transform((v): { text: string } => ({
      text: (v.text ?? v.content ?? '').trim(),
    }))
    .refine((v) => v.text.length > 0, {
      message: 'text (or content) is required',
      path: ['text'],
    });

export const SlideBlockSchema = z.union([
  z
    .object({
      type: z.literal('heading'),
      level: z.enum(['h1', 'h2', 'h3']).default('h2'),
    })
    .and(textish(120)),
  z.object({ type: z.literal('paragraph') }).and(textish(400)),
  z.object({
    type: z.literal('list'),
    items: z.array(z.string().min(1).max(200)).min(1).max(8),
    ordered: z.boolean().default(false),
  }),
  z
    .object({
      type: z.literal('quote'),
      attribution: z.string().max(80).optional(),
    })
    .and(textish(400)),
  z
    .object({
      type: z.literal('callout'),
      tone: z.enum(['info', 'tip', 'warn']).default('info'),
    })
    .and(textish(400)),
  z.object({
    type: z.literal('code'),
    code: z.string().min(1).max(2000),
    language: z.string().max(20).optional(),
  }),
  z.object({
    type: z.literal('stat'),
    value: z.string().min(1).max(40),
    label: z.string().min(1).max(120),
  }),
  z.object({
    type: z.literal('columns'),
    cols: z
      .array(
        z.object({
          heading: z.string().max(80).optional(),
          items: z.array(z.string().min(1).max(200)).min(1).max(6),
        }),
      )
      .min(2)
      .max(3),
  }),
]);

export type SlideBlock = z.infer<typeof SlideBlockSchema>;

export type DeckSlide = {
  layout: 'title' | 'bullets' | 'split' | 'statement' | 'summary';
  eyebrow?: string;
  title?: string;
  blocks: SlideBlock[];
  note?: string;
  visual?: SlideVisual;
};

export type DeckLayout = DeckSlide['layout'];

/** Maps any model-produced layout string to a known layout (lenient). */
export function normalizeLayout(l?: string): DeckLayout {
  if (!l) return 'bullets';
  const v = l.toLowerCase().replace(/[\s_-]+/g, '');
  if (v.startsWith('title')) return 'title';
  if (v.startsWith('summary') || v.startsWith('conclusion')) return 'summary';
  if (v.includes('statement') || v.includes('quote')) return 'statement';
  if (
    v.includes('split') ||
    v.includes('column') ||
    v.includes('two') ||
    v.includes('side')
  )
    return 'split';
  return 'bullets';
}

/**
 * Accepts both the new designer-deck slide shape (layout + blocks) and the
 * legacy shape (title + bullets/code/speakerNote) and normalizes to the new
 * shape so older stored payloads keep working.
 */
const DeckSlideSchema = z
  .object({
    layout: z.string().optional(),
    eyebrow: z.string().max(80).optional(),
    title: z.string().max(120).optional(),
    blocks: z.array(SlideBlockSchema).max(8).optional(),
    note: z.string().optional(),
    visual: SlideVisualSchema.optional(),
    bullets: z.array(z.string()).min(1).max(6).optional(),
    code: z.string().optional(),
    code_snippet: z.string().optional(),
    speakerNote: z.string().optional(),
    speaker_note: z.string().optional(),
  })
  .refine(
    (s) =>
      (s.blocks && s.blocks.length > 0) ||
      (s.bullets && s.bullets.length > 0) ||
      !!s.title,
    'A slide needs at least a title, blocks, or bullets',
  )
  .transform((s): DeckSlide => {
    if (s.blocks && s.blocks.length > 0) {
      return {
        layout: normalizeLayout(s.layout),
        eyebrow: s.eyebrow,
        title: s.title,
        blocks: s.blocks,
        note: s.note,
        visual: s.visual,
      };
    }
    const blocks: SlideBlock[] = [];
    const code = s.code ?? s.code_snippet;
    if (code) blocks.push({ type: 'code', code });
    const bullets = s.bullets ?? [];
    if (bullets.length > 0) {
      blocks.push({ type: 'list', items: bullets, ordered: false });
    }
    return {
      layout: 'bullets',
      eyebrow: s.eyebrow,
      title: s.title,
      blocks,
      note: s.note ?? s.speakerNote ?? s.speaker_note,
      visual: s.visual,
    };
  });

export const DeckSchema = z
  .union([
    z.object({
      title: z.string().optional().default('Lecture Slides'),
      theme: DeckThemeSchema.optional().default(DEFAULT_DECK_THEME),
      slides: z.array(DeckSlideSchema).min(3).max(14),
    }),
    z
      .array(DeckSlideSchema)
      .min(3)
      .max(14)
      .transform((slides) => ({ slides })),
  ])
  .transform((d) => ({
    title: 'title' in d && d.title ? d.title : 'Lecture Slides',
    theme: 'theme' in d && d.theme ? d.theme : DEFAULT_DECK_THEME,
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

export type Slide = DeckSlide;
