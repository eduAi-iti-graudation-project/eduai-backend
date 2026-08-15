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
  preset: z
    .enum(['modern', 'classic', 'dark', 'colorful', 'minimal'])
    .optional(),
  background: z.enum(['light', 'dark', 'gradient']).default('light'),
  colors: z
    .object({
      primary: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
      secondary: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
      accent: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
      text: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
    })
    .optional(),
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

export const THEME_PRESETS: Record<string, Required<DeckTheme>> = {
  modern: {
    preset: 'modern',
    background: 'light',
    colors: {
      primary: '#2563EB',
      secondary: '#7C3AED',
      accent: '#10B981',
      text: '#1F2937',
    },
    accent: '#10B981',
    motion: 'rise',
  },
  classic: {
    preset: 'classic',
    background: 'light',
    colors: {
      primary: '#1F2937',
      secondary: '#6B7280',
      accent: '#DC2626',
      text: '#1F2937',
    },
    accent: '#DC2626',
    motion: 'fade',
  },
  dark: {
    preset: 'dark',
    background: 'dark',
    colors: {
      primary: '#93C5FD',
      secondary: '#A78BFA',
      accent: '#6EE7B7',
      text: '#F1F5F9',
    },
    accent: '#6EE7B7',
    motion: 'slide',
  },
  colorful: {
    preset: 'colorful',
    background: 'gradient',
    colors: {
      primary: '#EC4899',
      secondary: '#8B5CF6',
      accent: '#F59E0B',
      text: '#1F2937',
    },
    accent: '#F59E0B',
    motion: 'scale',
  },
  minimal: {
    preset: 'minimal',
    background: 'light',
    colors: {
      primary: '#374151',
      secondary: '#9CA3AF',
      accent: '#6B7280',
      text: '#1F2937',
    },
    accent: '#6B7280',
    motion: 'fade',
  },
};

export function resolveTheme(theme: DeckTheme): Required<DeckTheme> & {
  colors: Required<NonNullable<DeckTheme['colors']>>;
} {
  if (theme.preset && THEME_PRESETS[theme.preset]) {
    const preset = THEME_PRESETS[theme.preset];
    return {
      ...preset,
      accent: theme.accent ?? preset.accent,
      colors: {
        primary: theme.colors?.primary ?? preset.colors.primary!,
        secondary: theme.colors?.secondary ?? preset.colors.secondary!,
        accent: theme.accent ?? theme.colors?.accent ?? preset.colors.accent!,
        text: theme.colors?.text ?? preset.colors.text!,
      },
    };
  }

  const base: Required<DeckTheme> & {
    colors: Required<NonNullable<DeckTheme['colors']>>;
  } = {
    preset: theme.preset ?? 'modern',
    background: theme.background,
    colors: {
      primary: theme.colors?.primary ?? '#2563EB',
      secondary: theme.colors?.secondary ?? '#7C3AED',
      accent: theme.accent ?? theme.colors?.accent ?? '#10B981',
      text: theme.colors?.text ?? '#1F2937',
    },
    accent: theme.accent ?? theme.colors?.accent ?? '#10B981',
    motion: theme.motion,
  };

  if (theme.background === 'dark') {
    base.colors = {
      primary: theme.colors?.primary ?? '#93C5FD',
      secondary: theme.colors?.secondary ?? '#A78BFA',
      accent: theme.accent ?? theme.colors?.accent ?? '#6EE7B7',
      text: theme.colors?.text ?? '#F1F5F9',
    };
  }

  return base;
}

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
  z
    .object({
      heading: z.union([
        z.string().min(1).max(120),
        z.object({ text: z.string().max(120), level: z.enum(['h1', 'h2', 'h3']).optional() }),
      ]),
    })
    .transform((v) =>
      typeof v.heading === 'string'
        ? { type: 'heading' as const, text: v.heading }
        : {
            type: 'heading' as const,
            text: v.heading.text,
            level: (v.heading.level ?? 'h2') as 'h2' | 'h1' | 'h3',
          },
    ),
  z
    .object({
      paragraph: z.string().min(1).max(400),
    })
    .transform((v) => ({ type: 'paragraph' as const, text: v.paragraph })),
  z
    .object({
      list: z.object({
        items: z.array(z.string().min(1).max(200)).min(1).max(8),
        ordered: z.boolean().optional(),
      }),
    })
    .transform((v) => ({
      type: 'list' as const,
      items: v.list.items,
      ordered: v.list.ordered ?? false,
    })),
  z
    .object({
      quote: z.union([
        z.string().min(1).max(400),
        z.object({ text: z.string().max(400), attribution: z.string().max(80).optional() }),
      ]),
    })
    .transform((v) =>
      typeof v.quote === 'string'
        ? { type: 'quote' as const, text: v.quote }
        : { type: 'quote' as const, text: v.quote.text, attribution: v.quote.attribution },
    ),
  z
    .object({
      callout: z.union([
        z.string().min(1).max(400),
        z.object({
          text: z.string().max(400),
          tone: z.enum(['info', 'tip', 'warn']).optional(),
        }),
      ]),
    })
    .transform((v) =>
      typeof v.callout === 'string'
        ? { type: 'callout' as const, text: v.callout, tone: 'info' as const }
        : {
            type: 'callout' as const,
            text: v.callout.text,
            tone: (v.callout.tone ?? 'info') as 'info' | 'tip' | 'warn',
          },
    ),
  z
    .object({
      code: z.string().min(1).max(2000),
    })
    .transform((v) => ({ type: 'code' as const, code: v.code })),
  z
    .object({
      stat: z.object({
        value: z.string().min(1).max(40),
        label: z.string().min(1).max(120),
      }),
    })
    .transform((v) => ({ type: 'stat' as const, value: v.stat.value, label: v.stat.label })),
  z
    .object({
      columns: z.object({
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
    })
    .transform((v) => ({ type: 'columns' as const, cols: v.columns.cols })),
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
    block: SlideBlockSchema.optional(),
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
      !!s.block ||
      (s.bullets && s.bullets.length > 0) ||
      !!s.title,
    'A slide needs at least a title, blocks, or bullets',
  )
  .transform((s): DeckSlide => {
    const singleBlock = s.block ? [s.block] : [];
    if (s.blocks && s.blocks.length > 0) {
      return {
        layout: normalizeLayout(s.layout),
        eyebrow: s.eyebrow,
        title: s.title,
        blocks: [...singleBlock, ...s.blocks],
        note: s.note,
        visual: s.visual,
      };
    }
    const blocks: SlideBlock[] = [...singleBlock];
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
