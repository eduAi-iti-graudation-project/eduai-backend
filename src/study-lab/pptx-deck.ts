import type { Deck, SlideBlock, SlideVisual, DeckTheme } from './schemas';
import { resolveTheme, THEME_PRESETS } from './schemas';

export type PptxRun = {
  text: string;
  options?: {
    bold?: boolean;
    italic?: boolean;
    color?: string;
    fontSize?: number;
    fontFace?: string;
    highlight?: string;
    bullet?: boolean | { type: 'number' };
  };
};

export type PptxTextbox = {
  kind: 'textbox';
  x: number;
  y: number;
  w: number;
  h: number;
  runs: PptxRun[];
  options?: {
    align?: 'left' | 'center' | 'right';
    valign?: 'top' | 'middle' | 'bottom';
    lineSpacingMultiple?: number;
    paraSpaceAfter?: number;
  };
};

export type PptxShape = {
  kind: 'shape';
  shapeType: 'rect' | 'roundRect';
  x: number;
  y: number;
  w: number;
  h: number;
  fill?: string;
  line?: { color: string; width: number };
};

export type PptxImage = {
  kind: 'image';
  x: number;
  y: number;
  w: number;
  h: number;
  data: Buffer;
};

export type PptxSlideModel = {
  background?: string;
  shapes: PptxShape[];
  textboxes: PptxTextbox[];
  images: PptxImage[];
  notes?: string;
};

export type PptxDeckModel = {
  slides: PptxSlideModel[];
};

type Palette = {
  background: string;
  surface: string;
  text: string;
  muted: string;
  primary: string;
  accent: string;
  codeBg: string;
  codeFg: string;
};

function paletteFor(theme: DeckTheme): Palette {
  const resolved = resolveTheme(theme);
  const light: Palette = {
    background: 'FFFFFF',
    surface: 'F8FAFC',
    text: resolved.colors.text.replace('#', ''),
    muted: '6B7280',
    primary: resolved.colors.primary.replace('#', ''),
    accent: resolved.colors.accent.replace('#', ''),
    codeBg: '0F172A',
    codeFg: '34D399',
  };
  const dark: Palette = {
    background: '0F172A',
    surface: '1E293B',
    text: resolved.colors.text.replace('#', ''),
    muted: '94A3B8',
    primary: resolved.colors.primary.replace('#', ''),
    accent: resolved.colors.accent.replace('#', ''),
    codeBg: '1E293B',
    codeFg: '6EE7B7',
  };
  if (resolved.background === 'dark') return dark;
  if (resolved.background === 'gradient') {
    return { ...light, background: 'EEF2FF', surface: 'FFFFFF' };
  }
  return light;
}

const CALL_OUT_TONES: Record<string, { fill: string; border: string }> = {
  info: { fill: 'EFF6FF', border: '2563EB' },
  tip: { fill: 'ECFDF5', border: '10B981' },
  warn: { fill: 'FEF3C7', border: 'F59E0B' },
};

const CONTENT_X = 0.7;
const CONTENT_W = 12.0;
const TOP = 1.6;
const BOTTOM = 7.0;

function blockToElements(
  block: SlideBlock,
  palette: Palette,
  x: number,
  w: number,
  y: number,
): { elements: (PptxTextbox | PptxShape)[]; height: number } {
  const elements: (PptxTextbox | PptxShape)[] = [];
  const run = (text: string, options?: PptxRun['options']): PptxRun => ({
    text,
    options,
  });

  switch (block.type) {
    case 'heading': {
      const size = block.level === 'h1' ? 26 : block.level === 'h2' ? 21 : 17;
      return {
        elements: [
          {
            kind: 'textbox',
            x,
            y,
            w,
            h: size / 72 + 0.2,
            runs: [
              run(block.text, {
                bold: true,
                color: palette.primary,
                fontSize: size,
              }),
            ],
          },
        ],
        height: size / 72 + 0.3,
      };
    }
    case 'paragraph': {
      const lines = Math.max(1, Math.ceil(block.text.length / 90));
      const height = lines * 0.3 + 0.15;
      return {
        elements: [
          {
            kind: 'textbox',
            x,
            y,
            w,
            h: height,
            runs: [run(block.text, { color: palette.text, fontSize: 15 })],
            options: { lineSpacingMultiple: 1.35 },
          },
        ],
        height,
      };
    }
    case 'list': {
      const runs = block.items.map((item, i) =>
        run(item, {
          bullet: block.ordered ? { type: 'number' } : true,
          color: palette.text,
          fontSize: 15,
          ...(i > 0 ? {} : {}),
        }),
      );
      const height = block.items.length * 0.32 + 0.2;
      return {
        elements: [
          {
            kind: 'textbox',
            x,
            y,
            w,
            h: height,
            runs,
            options: { lineSpacingMultiple: 1.25, paraSpaceAfter: 6 },
          },
        ],
        height,
      };
    }
    case 'quote': {
      const height = Math.max(0.7, (block.text.length / 90) * 0.3 + 0.3);
      elements.push({
        kind: 'shape',
        shapeType: 'rect',
        x,
        y,
        w: 0.09,
        h: height,
        fill: palette.accent,
      });
      elements.push({
        kind: 'textbox',
        x: x + 0.25,
        y: y + 0.05,
        w: w - 0.35,
        h: height - 0.1,
        runs: [
          run(block.text, {
            italic: true,
            color: palette.text,
            fontSize: 15,
            ...(block.attribution ? {} : {}),
          }),
          ...(block.attribution
            ? [
                run(`  — ${block.attribution}`, {
                  italic: true,
                  color: palette.muted,
                  fontSize: 12,
                }),
              ]
            : []),
        ],
        options: { lineSpacingMultiple: 1.3 },
      });
      return { elements, height: height + 0.1 };
    }
    case 'callout': {
      const tone = CALL_OUT_TONES[block.tone] ?? CALL_OUT_TONES.info;
      const height = Math.max(0.55, (block.text.length / 80) * 0.28 + 0.3);
      elements.push({
        kind: 'shape',
        shapeType: 'roundRect',
        x,
        y,
        w,
        h: height,
        fill: tone.fill,
        line: { color: tone.border, width: 1.25 },
      });
      elements.push({
        kind: 'textbox',
        x: x + 0.3,
        y: y + 0.08,
        w: w - 0.6,
        h: height - 0.16,
        runs: [run(block.text, { color: '1F2937', fontSize: 14 })],
        options: { lineSpacingMultiple: 1.25, valign: 'middle' },
      });
      return { elements, height: height + 0.12 };
    }
    case 'code': {
      const lines = block.code.split('\n').length;
      const height = lines * 0.22 + 0.3;
      elements.push({
        kind: 'shape',
        shapeType: 'rect',
        x,
        y,
        w,
        h: height,
        fill: palette.codeBg,
      });
      elements.push({
        kind: 'textbox',
        x: x + 0.25,
        y: y + 0.12,
        w: w - 0.5,
        h: height - 0.24,
        runs: [
          run(block.code, {
            fontFace: 'Consolas',
            color: palette.codeFg,
            fontSize: 12,
          }),
        ],
        options: { lineSpacingMultiple: 1.15 },
      });
      return { elements, height: height + 0.12 };
    }
    case 'stat': {
      const height = 0.9;
      return {
        elements: [
          {
            kind: 'textbox',
            x,
            y,
            w,
            h: height,
            runs: [
              run(block.value, {
                bold: true,
                color: palette.primary,
                fontSize: 34,
              }),
              run(`  ${block.label}`, { color: palette.muted, fontSize: 14 }),
            ],
            options: { valign: 'middle' },
          },
        ],
        height,
      };
    }
    case 'columns': {
      const colW = (w - (block.cols.length - 1) * 0.25) / block.cols.length;
      let maxH = 0;
      block.cols.forEach((col, i) => {
        const colX = x + i * (colW + 0.25);
        const colRuns: PptxRun[] = [
          ...(col.heading
            ? [
                run(col.heading, {
                  bold: true,
                  color: palette.primary,
                  fontSize: 15,
                }),
              ]
            : []),
          ...col.items.map((item, j) =>
            run(item, {
              bullet: true,
              color: palette.text,
              fontSize: 13,
              ...(j === 0 && col.heading ? {} : {}),
            }),
          ),
        ];
        const headingH = col.heading ? 0.3 : 0;
        const height = headingH + col.items.length * 0.28 + 0.1;
        maxH = Math.max(maxH, height);
        elements.push({
          kind: 'textbox',
          x: colX,
          y,
          w: colW,
          h: height,
          runs: colRuns,
          options: { lineSpacingMultiple: 1.2, paraSpaceAfter: 4 },
        });
      });
      return { elements, height: maxH };
    }
    default:
      return { elements: [], height: 0 };
  }
}

function buildBodySlide(
  slide: {
    layout: string;
    eyebrow?: string;
    title?: string;
    blocks: SlideBlock[];
    note?: string;
    visual?: SlideVisual;
  },
  index: number,
  palette: Palette,
  visualPng?: Buffer | null,
): PptxSlideModel {
  const shapes: PptxShape[] = [];
  const textboxes: PptxTextbox[] = [];
  const images: PptxImage[] = [];

  // Header
  let y = 0.45;
  if (slide.eyebrow) {
    textboxes.push({
      kind: 'textbox',
      x: CONTENT_X,
      y,
      w: CONTENT_W,
      h: 0.3,
      runs: [
        {
          text: slide.eyebrow.toUpperCase(),
          options: { bold: true, color: palette.accent, fontSize: 11 },
        },
      ],
    });
    y += 0.34;
  }
  if (slide.title) {
    textboxes.push({
      kind: 'textbox',
      x: CONTENT_X,
      y,
      w: CONTENT_W,
      h: 0.65,
      runs: [
        {
          text: slide.title,
          options: { bold: true, color: palette.primary, fontSize: 26 },
        },
      ],
    });
    shapes.push({
      kind: 'shape',
      shapeType: 'rect',
      x: CONTENT_X,
      y: y + 0.68,
      w: 1.4,
      h: 0.05,
      fill: palette.accent,
    });
    y += 0.85;
  } else {
    y = TOP;
  }
  y = Math.max(y, TOP);

  const split = slide.layout === 'split' && visualPng;
  const textX = split ? CONTENT_X : CONTENT_X;
  const textW = split ? 5.7 : CONTENT_W;

  for (const block of slide.blocks) {
    if (y > BOTTOM - 0.3) break;
    const { elements, height } = blockToElements(
      block,
      palette,
      textX,
      textW,
      y,
    );
    shapes.push(...elements.filter((e): e is PptxShape => e.kind === 'shape'));
    textboxes.push(
      ...elements.filter((e): e is PptxTextbox => e.kind === 'textbox'),
    );
    y += height + 0.12;
  }

  if (visualPng) {
    images.push({
      kind: 'image',
      x: split ? 6.7 : 1.2,
      y: split ? TOP : 4.2,
      w: split ? 6.0 : 10.9,
      h: split ? 4.8 : 2.6,
      data: visualPng,
    });
  }

  return {
    shapes,
    textboxes,
    images,
    notes: slide.note,
  };
}

export function buildDeckModel(
  deck: Deck,
  visualPngs?: (Buffer | null)[],
): PptxDeckModel {
  const palette = paletteFor(deck.theme);
  const slides: PptxSlideModel[] = [];

  deck.slides.forEach((slide, i) => {
    if (i === 0 && (slide.layout === 'title' || slide.blocks.length === 0)) {
      const isDark = deck.theme.background === 'dark';
      const titleBg = isDark ? palette.background : palette.primary;
      const titleFg = isDark ? palette.text : 'FFFFFF';
      const subtitleFg = isDark ? palette.muted : 'E5E7EB';
      const barFill = isDark ? palette.accent : 'FFFFFF';
      const subtitle = slide.eyebrow ?? slide.note ?? '';
      slides.push({
        background: titleBg,
        shapes: [
          {
            kind: 'shape',
            shapeType: 'rect',
            x: 4.4,
            y: 3.6,
            w: 1.6,
            h: 0.07,
            fill: barFill,
          },
        ],
        textboxes: [
          {
            kind: 'textbox',
            x: 0.8,
            y: 2.5,
            w: 11.7,
            h: 1.1,
            runs: [
              {
                text: deck.title,
                options: { bold: true, color: titleFg, fontSize: 40 },
              },
            ],
            options: { align: 'center' as const },
          },
          ...(subtitle
            ? [
                {
                  kind: 'textbox' as const,
                  x: 2,
                  y: 3.85,
                  w: 9.3,
                  h: 0.6,
                  runs: [
                    {
                      text: subtitle,
                      options: { color: subtitleFg, fontSize: 16 },
                    },
                  ],
                  options: { align: 'center' as const },
                },
              ]
            : []),
        ],
        images: [],
        notes: slide.note,
      });
      return;
    }

    slides.push(buildBodySlide(slide, i, palette, visualPngs?.[i] ?? null));
  });

  return { slides };
}
