import {
  renderSlideVisuals,
  renderVisualToPng,
  renderVisualToSvg,
} from './visual-renderer';
import type { Deck, SlideVisual } from './schemas';

const allVisuals: SlideVisual[] = [
  {
    kind: 'bar',
    title: 'Enrollment',
    categories: ['2021', '2022', '2023'],
    series: [{ label: 'Students', values: [120, 160, 210] }],
  },
  {
    kind: 'line',
    categories: ['Q1', 'Q2', 'Q3'],
    series: [
      { label: 'A', values: [1, 2, 3] },
      { label: 'B', values: [3, 2, 1] },
    ],
  },
  {
    kind: 'pie',
    categories: ['A', 'B'],
    series: [{ label: 'H', values: [3, 1] }],
  },
  {
    kind: 'area',
    categories: ['W1', 'W2', 'W3'],
    series: [{ label: 'S', values: [1, 4, 2] }],
  },
  {
    kind: 'flow',
    steps: [{ label: 'Step one' }, { label: 'Step two', detail: 'A detail' }],
  },
  {
    kind: 'timeline',
    events: [{ label: 'Start', detail: '2020' }, { label: 'End' }],
  },
  {
    kind: 'comparison',
    leftTitle: 'Left',
    rightTitle: 'Right',
    rows: [{ left: 'a', right: 'b' }],
  },
  {
    kind: 'concept_map',
    nodes: [
      { id: 'a', label: 'Alpha' },
      { id: 'b', label: 'Beta' },
    ],
    edges: [{ from: 'a', to: 'b', label: 'links' }],
  },
];

describe('visual-renderer', () => {
  it('renders an SVG for every visual kind', () => {
    for (const visual of allVisuals) {
      const svg = renderVisualToSvg(visual);
      expect(svg).toContain('<svg');
      expect(svg).toContain('</svg>');
    }
  });

  it('renders a non-empty PNG for every visual kind', () => {
    for (const visual of allVisuals) {
      const png = renderVisualToPng(visual);
      expect(png.length).toBeGreaterThan(100);
      expect(png.subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
    }
  });

  it('skips slides without visuals and keeps raster failures null', () => {
    const deck: Deck = {
      title: 'T',
      theme: { background: 'light', motion: 'rise' },
      slides: [
        {
          layout: 'bullets',
          eyebrow: undefined,
          title: 'T1',
          blocks: [{ type: 'list', items: ['a'], ordered: false }],
          note: undefined,
          visual: allVisuals[0],
        },
        {
          layout: 'bullets',
          eyebrow: undefined,
          title: 'T2',
          blocks: [{ type: 'list', items: ['b'], ordered: false }],
          note: undefined,
          visual: undefined,
        },
        {
          layout: 'bullets',
          eyebrow: undefined,
          title: 'T3',
          blocks: [{ type: 'list', items: ['c'], ordered: false }],
          note: undefined,
          visual: allVisuals[1],
        },
      ],
    };
    const pngs = renderSlideVisuals(deck);
    expect(pngs).toHaveLength(3);
    expect(pngs[0]).toBeInstanceOf(Buffer);
    expect(pngs[1]).toBeNull();
    expect(pngs[2]).toBeInstanceOf(Buffer);
  });
});
