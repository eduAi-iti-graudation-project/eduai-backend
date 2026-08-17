import { DeckSchema, type Deck, type SlideBlock } from './schemas';
import { buildDeckModel } from './pptx-deck';

function deckWith(blocks: SlideBlock[], overrides: Partial<Deck> = {}): Deck {
  return {
    title: 'Test Deck',
    theme: { background: 'light', motion: 'rise' },
    slides: [
      { layout: 'title', title: 'Test Deck', blocks: [] },
      {
        layout: 'bullets',
        eyebrow: 'Section 1',
        title: 'Content',
        blocks,
        note: 'speaker note',
      },
    ],
    ...overrides,
  };
}

describe('pptx-deck', () => {
  it('maps each block type to pptx primitives', () => {
    const blocks: SlideBlock[] = [
      { type: 'heading', text: 'Heading', level: 'h2' },
      { type: 'paragraph', text: 'A paragraph of explanation.' },
      { type: 'list', items: ['one', 'two'], ordered: false },
      { type: 'quote', text: 'A definition.', attribution: 'Author' },
      { type: 'callout', text: 'Exam tip', tone: 'warn' },
      { type: 'code', code: 'x = 1\nprint(x)' },
      { type: 'stat', value: '9.8', label: 'm/s²' },
      {
        type: 'columns',
        cols: [
          { heading: 'A', items: ['a1'] },
          { heading: 'B', items: ['b1'] },
        ],
      },
    ];
    const model = buildDeckModel(deckWith(blocks));
    const body = model.slides[1];
    const textboxes = body.textboxes;
    const shapes = body.shapes;
    expect(shapes.some((s) => s.shapeType === 'roundRect')).toBe(true); // callout
    expect(
      shapes.some((s) => s.shapeType === 'rect' && s.fill === '0F172A'),
    ).toBe(true); // code box
    expect(textboxes.some((t) => t.runs.some((r) => r.options?.bold))).toBe(
      true,
    ); // heading
    expect(textboxes.some((t) => t.runs.some((r) => r.options?.italic))).toBe(
      true,
    ); // quote
    expect(textboxes.some((t) => t.runs.some((r) => r.options?.bullet))).toBe(
      true,
    ); // list
    expect(
      textboxes.some((t) =>
        t.runs.some((r) => r.options?.fontFace === 'Consolas'),
      ),
    ).toBe(true); // code
    expect(body.notes).toBe('speaker note');
  });

  it('renders a title slide for index 0 with light background', () => {
    const model = buildDeckModel(
      deckWith([], {
        theme: { background: 'light', accent: '#FF8800', motion: 'slide' },
      }),
    );
    const title = model.slides[0];
    expect(title.background).toBe('FFFFFF');
    expect(title.textboxes[0].runs[0].text).toBe('Test Deck');
  });

  it('uses dark palette for dark theme', () => {
    const model = buildDeckModel(
      deckWith([{ type: 'paragraph', text: 'hello' }], {
        theme: { background: 'dark', motion: 'fade' },
      }),
    );
    expect(model.slides[0].background).toBe('0F172A');
    const body = model.slides[1];
    expect(body.textboxes[2].runs[0].options?.color).toBe('F1F5F9');
  });

  it('places a visual image for split layout and legacy normalization works', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const model = buildDeckModel(
      deckWith([{ type: 'list', items: ['a'], ordered: false }], {
        slides: [
          { layout: 'title', title: 'Test Deck', blocks: [] },
          {
            layout: 'split',
            title: 'Split',
            blocks: [{ type: 'list', items: ['a'], ordered: false }],
            visual: {
              kind: 'comparison',
              leftTitle: 'L',
              rightTitle: 'R',
              rows: [{ left: 'x', right: 'y' }],
            },
          },
        ],
      }),
      [null, png],
    );
    expect(model.slides[1].images).toHaveLength(1);
    expect(model.slides[1].images[0].data).toBe(png);
  });
});

describe('DeckSchema legacy normalization', () => {
  it('converts legacy bullets/code/speakerNote slides to blocks', () => {
    const legacy = {
      title: 'Legacy Deck',
      slides: [
        { title: 'Intro', bullets: ['a', 'b'] },
        {
          title: 'Detail',
          bullets: ['c'],
          code: 'fn main() {}',
          speakerNote: 'say this',
          visual: {
            kind: 'flow',
            steps: [{ label: 'Step 1' }, { label: 'Step 2' }],
          },
        },
        { title: 'Summary', bullets: ['wrap up'] },
      ],
    };
    const deck = DeckSchema.parse(legacy);
    expect(deck.slides).toHaveLength(3);
    const detail = deck.slides[1];
    expect(detail.blocks.map((b) => b.type)).toEqual(['code', 'list']);
    expect(detail.note).toBe('say this');
    expect(detail.visual?.kind).toBe('flow');
    expect(detail.layout).toBe('bullets');
    expect(deck.theme.background).toBe('light');
  });

  it('accepts new designer-deck shape', () => {
    const modern = {
      title: 'Modern',
      theme: { background: 'dark', accent: '#FF8800', motion: 'scale' },
      slides: [
        { layout: 'title', title: 'Modern' },
        {
          layout: 'statement',
          eyebrow: 'Key idea',
          title: 'Everything is connected',
          blocks: [{ type: 'callout', text: 'core concept', tone: 'info' }],
        },
        {
          layout: 'summary',
          title: 'Takeaways',
          blocks: [{ type: 'list', items: ['a', 'b', 'c'], ordered: false }],
        },
      ],
    };
    const deck = DeckSchema.parse(modern);
    expect(deck.theme.background).toBe('dark');
    expect(deck.theme.accent).toBe('#FF8800');
    expect(deck.slides[1].blocks[0].type).toBe('callout');
  });
});
