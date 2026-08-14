import { Resvg } from '@resvg/resvg-js';
import type {
  ChartVisual,
  ComparisonVisual,
  ConceptMapVisual,
  Deck,
  FlowVisual,
  SlideVisual,
  TimelineVisual,
} from './schemas';

const W = 1200;
const H = 540;
const COLORS = {
  primary: '#2563EB',
  text: '#1F2937',
  muted: '#6B7280',
  accent: '#10B981',
  bg: '#FFFFFF',
  grid: '#E5E7EB',
  border: '#CBD5E1',
  nodeBg: '#EFF6FF',
};
const SERIES_COLORS = ['#2563EB', '#10B981', '#F59E0B'];
const FONT_ATTR =
  "font-family='Segoe UI, system-ui, -apple-system, sans-serif'";

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function wrap(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) {
      current = word;
    } else if (`${current} ${word}`.length <= maxChars) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 3);
}

function textEl(
  x: number,
  y: number,
  content: string,
  opts: { size?: number; weight?: number; fill?: string; anchor?: string } = {},
): string {
  const size = opts.size ?? 16;
  const weight = opts.weight ?? 400;
  const fill = opts.fill ?? COLORS.text;
  const anchor = opts.anchor ?? 'start';
  return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(
    content,
  )}</text>`;
}

function centerText(
  cx: number,
  cy: number,
  lines: string[],
  opts: { size?: number; weight?: number; fill?: string } = {},
): string {
  const size = opts.size ?? 16;
  const weight = opts.weight ?? 400;
  const fill = opts.fill ?? COLORS.text;
  const lineH = size * 1.25;
  const start = cy - ((lines.length - 1) * lineH) / 2;
  return lines
    .map(
      (line, i) =>
        `<text x="${cx.toFixed(1)}" y="${(start + i * lineH).toFixed(1)}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="middle">${esc(
          line,
        )}</text>`,
    )
    .join('');
}

function titleSvg(title: string): string {
  return textEl(60, 46, title, {
    size: 26,
    weight: 700,
    fill: COLORS.primary,
  });
}

function legend(items: { label: string; color: string }[]): string {
  let x = W - 40;
  const rows = items
    .map((item) => {
      const size = item.label.length * 7.5;
      x -= size;
      const swatchX = x - 18;
      const out = `<rect x="${swatchX}" y="44" width="13" height="13" rx="3" fill="${item.color}"/>${textEl(
        x,
        55,
        item.label,
        { size: 13, fill: COLORS.muted },
      )}`;
      x -= 28;
      return out;
    })
    .reverse()
    .join('');
  return `<g>${rows}</g>`;
}

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(value)));
  const n = value / pow;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return nice * pow;
}

function renderChart(v: ChartVisual): string {
  if (v.kind === 'pie') return renderPie(v);
  const margin = { top: 90, right: 60, bottom: 80, left: 80 };
  const plotW = W - margin.left - margin.right;
  const plotH = H - margin.top - margin.bottom;
  const maxVal = niceMax(Math.max(0, ...v.series.flatMap((s) => s.values)));
  const yTicks = 5;
  const tickStep = maxVal / yTicks;

  let yAxis = '';
  let grid = '';
  for (let i = 0; i <= yTicks; i++) {
    const y = margin.top + plotH - (i / yTicks) * plotH;
    const val = tickStep * i;
    grid += `<line x1="${margin.left}" y1="${y.toFixed(1)}" x2="${margin.left + plotW}" y2="${y.toFixed(1)}" stroke="${COLORS.grid}" stroke-width="1"/>`;
    yAxis += textEl(
      margin.left - 12,
      y + 5,
      String(Math.round(val * 10) / 10),
      {
        size: 12,
        fill: COLORS.muted,
        anchor: 'end',
      },
    );
  }
  grid += `<line x1="${margin.left}" y1="${margin.top + plotH}" x2="${margin.left + plotW}" y2="${margin.top + plotH}" stroke="${COLORS.border}" stroke-width="2"/>`;

  const nCat = v.categories.length;
  const groupW = plotW / nCat;
  const catMaxChars = Math.max(4, Math.floor(groupW / 7));

  const xAxis = '';
  let chart = '';
  if (v.kind === 'bar') {
    const nSeries = v.series.length;
    const barW = (groupW * 0.7) / nSeries;
    const groupX = margin.left + (groupW - barW * nSeries) / 2;
    v.categories.forEach((cat, i) => {
      v.series.forEach((s, j) => {
        const x = groupX + i * groupW + j * barW;
        const h = (Math.max(0, s.values[i] ?? 0) / maxVal) * plotH;
        chart += `<rect x="${x.toFixed(1)}" y="${(margin.top + plotH - h).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${SERIES_COLORS[j % SERIES_COLORS.length]}"/>`;
      });
      const lines = wrap(cat, catMaxChars);
      centerText(
        margin.left + i * groupW + groupW / 2,
        margin.top + plotH + 24 + lines.length * 8,
        lines,
        { size: 13, fill: COLORS.muted },
      );
    });
  } else {
    const xStep = plotW / Math.max(1, nCat - 1);
    v.series.forEach((s, j) => {
      const color = SERIES_COLORS[j % SERIES_COLORS.length];
      const points = v.categories.map((_, i) => ({
        x: margin.left + i * xStep,
        y:
          margin.top + plotH - (Math.max(0, s.values[i] ?? 0) / maxVal) * plotH,
      }));
      const line = points
        .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
        .join(' ');
      if (v.kind === 'area') {
        const base = margin.top + plotH;
        const area =
          points.length > 1
            ? `${margin.left},${base} ${line} ${margin.left + plotW},${base}`
            : `${margin.left},${base} ${margin.left},${points[0]?.y ?? base} ${margin.left + plotW},${points[0]?.y ?? base} ${margin.left + plotW},${base}`;
        chart += `<polygon points="${area}" fill="${color}" opacity="0.15"/>`;
      }
      chart += `<polyline points="${line}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`;
      points.forEach((p, i) => {
        chart += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="${color}"/>`;
        if (i === points.length - 1) {
          chart += centerText(
            p.x + 14,
            p.y + 4,
            [String(Math.round(s.values[i] ?? 0))],
            { size: 12, weight: 700, fill: color },
          );
        }
      });
    });
    v.categories.forEach((cat, i) => {
      const lines = wrap(cat, catMaxChars);
      centerText(
        margin.left + i * xStep,
        margin.top + plotH + 24 + lines.length * 8,
        lines,
        { size: 13, fill: COLORS.muted },
      );
    });
  }

  if (v.xLabel) {
    centerText(W / 2, H - 18, [v.xLabel], { size: 13, fill: COLORS.muted });
  }
  if (v.yLabel) {
    const lines = wrap(v.yLabel, 10);
    centerText(28, H / 2, lines, { size: 13, fill: COLORS.muted });
  }

  const legendSvg = legend(
    v.series.map((s, j) => ({
      label: s.label,
      color: SERIES_COLORS[j % SERIES_COLORS.length],
    })),
  );

  return `${titleSvg(v.title ?? '')}${legendSvg}${grid}${yAxis}${chart}${xAxis}`;
}

function renderPie(v: ChartVisual): string {
  const total =
    v.series[0]?.values.reduce((a, b) => a + Math.max(0, b), 0) ?? 0;
  const cx = 330;
  const cy = H / 2 + 10;
  const r = 170;
  let startAngle = -Math.PI / 2;
  let slices = '';
  if (total > 0) {
    v.categories.forEach((cat, i) => {
      const value = Math.max(0, v.series[0]?.values[i] ?? 0);
      const frac = value / total;
      const endAngle = startAngle + frac * Math.PI * 2;
      const largeArc = frac > 0.5 ? 1 : 0;
      const x1 = cx + r * Math.cos(startAngle);
      const y1 = cy + r * Math.sin(startAngle);
      const x2 = cx + r * Math.cos(endAngle);
      const y2 = cy + r * Math.sin(endAngle);
      const color = SERIES_COLORS[i % SERIES_COLORS.length];
      slices += `<path d="M ${cx},${cy} L ${x1.toFixed(1)},${y1.toFixed(1)} A ${r},${r} 0 ${largeArc} 1 ${x2.toFixed(1)},${y2.toFixed(1)} Z" fill="${color}"/>`;
      if (frac > 0.04) {
        const mid = startAngle + frac * Math.PI;
        const lx = cx + r * 1.28 * Math.cos(mid);
        const ly = cy + r * 1.28 * Math.sin(mid);
        slices += centerText(lx, ly, [`${Math.round(frac * 100)}%`], {
          size: 15,
          weight: 700,
          fill: COLORS.text,
        });
      }
      startAngle = endAngle;
    });
  }

  const legendX = 620;
  const legendSvg = v.categories
    .map((cat, i) => {
      const y = 120 + i * 44;
      const value = v.series[0]?.values[i] ?? 0;
      const pct =
        total > 0 ? Math.round((Math.max(0, value) / total) * 100) : 0;
      const color = SERIES_COLORS[i % SERIES_COLORS.length];
      const labelLines = wrap(cat, 40);
      const body = labelLines
        .map(
          (line, li) =>
            `<text x="${legendX}" y="${(y + 16 + li * 16).toFixed(1)}" font-size="15" fill="${COLORS.text}">${esc(
              line,
            )}</text>`,
        )
        .join('');
      return `<g><rect x="${legendX - 24}" y="${y}" width="14" height="14" rx="3" fill="${color}"/>${body}<text x="${legendX}" y="${
        y + 16 + labelLines.length * 16
      }" font-size="13" font-weight="700" fill="${COLORS.muted}">${value} · ${pct}%</text></g>`;
    })
    .join('');

  return `${titleSvg(v.title ?? '')}${slices}${legendSvg}`;
}

function renderFlow(v: FlowVisual): string {
  const n = v.steps.length;
  const arrow = (x1: number, y1: number, x2: number, y2: number) =>
    `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${COLORS.muted}" stroke-width="2" marker-end="url(#arrow)"/>`;

  let body = '';
  if (n <= 4) {
    const arrowsW = (n - 1) * 46;
    const boxW = (W - 140 - arrowsW) / n;
    const boxH = 180;
    const boxY = (H - boxH) / 2;
    v.steps.forEach((s, i) => {
      const x = 70 + i * (boxW + 46);
      body += `<rect x="${x.toFixed(1)}" y="${boxY}" width="${boxW.toFixed(1)}" height="${boxH}" rx="12" fill="${COLORS.nodeBg}" stroke="${COLORS.primary}" stroke-width="2.5"/>`;
      const lines = wrap(s.label, Math.max(4, Math.floor(boxW / 7)));
      const detail = s.detail
        ? wrap(s.detail, Math.max(4, Math.floor(boxW / 6))).slice(0, 2)
        : [];
      body += centerText(
        x + boxW / 2,
        boxY + boxH / 2 - (detail.length > 0 ? 18 : 0),
        lines,
        {
          size: 17,
          weight: 700,
          fill: COLORS.text,
        },
      );
      if (detail.length > 0) {
        body += centerText(x + boxW / 2, boxY + boxH / 2 + 26, detail, {
          size: 13,
          fill: COLORS.muted,
        });
      }
      if (i < n - 1)
        body += arrow(
          x + boxW,
          boxY + boxH / 2,
          x + boxW + 46,
          boxY + boxH / 2,
        );
    });
  } else {
    const top = 70;
    const bottom = 480;
    const gap = (bottom - top) / n;
    const boxH = Math.min(56, gap * 0.6);
    const boxW = 760;
    const boxX = (W - boxW) / 2;
    v.steps.forEach((s, i) => {
      const y = top + i * gap + (gap - boxH) / 2;
      body += `<rect x="${boxX}" y="${y.toFixed(1)}" width="${boxW}" height="${boxH.toFixed(1)}" rx="10" fill="${COLORS.nodeBg}" stroke="${COLORS.primary}" stroke-width="2.5"/>`;
      const lines = wrap(s.label, 60);
      body += centerText(W / 2, y + boxH / 2 + 5, lines, {
        size: boxH >= 42 ? 16 : 14,
        weight: 700,
        fill: COLORS.text,
      });
      if (i < n - 1) body += arrow(W / 2, y + boxH, W / 2, top + (i + 1) * gap);
    });
  }

  return `${titleSvg(v.title ?? '')}<defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="${COLORS.muted}"/></marker></defs>${body}`;
}

function renderTimeline(v: TimelineVisual): string {
  const n = v.events.length;
  const x1 = 90;
  const x2 = W - 90;
  const y = 270;
  const step = (x2 - x1) / (n + 1);
  const maxChars = Math.max(6, Math.floor((step * 0.95) / 6.5));
  let body = `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${COLORS.border}" stroke-width="3"/>`;
  v.events.forEach((ev, i) => {
    const x = x1 + step * (i + 1);
    body += `<circle cx="${x.toFixed(1)}" cy="${y}" r="8" fill="${COLORS.primary}" stroke="${COLORS.bg}" stroke-width="3"/>`;
    const above = i % 2 === 0;
    const lines = wrap(ev.label, maxChars);
    const detail = ev.detail ? wrap(ev.detail, maxChars).slice(0, 2) : [];
    const anchor = above ? y - 30 : y + 30;
    if (above) {
      const blockY =
        anchor -
        lines.length * 14 -
        (detail.length > 0 ? detail.length * 14 + 4 : 0);
      body += centerText(x, blockY + 10, lines, {
        size: 15,
        weight: 700,
        fill: COLORS.text,
      });
      if (detail.length > 0) {
        body += centerText(x, anchor - detail.length * 13, detail, {
          size: 12,
          fill: COLORS.muted,
        });
      }
    } else {
      body += centerText(x, anchor + 14, lines, {
        size: 15,
        weight: 700,
        fill: COLORS.text,
      });
      if (detail.length > 0) {
        body += centerText(x, anchor + 14 + lines.length * 15, detail, {
          size: 12,
          fill: COLORS.muted,
        });
      }
    }
  });
  return `${titleSvg(v.title ?? '')}${body}`;
}

function renderComparison(v: ComparisonVisual): string {
  const colW = (W - 140) / 2;
  const headerH = 48;
  const headerY = 78;
  let body =
    `<rect x="70" y="${headerY}" width="${colW}" height="${headerH}" fill="${COLORS.primary}"/>` +
    `<rect x="${70 + colW}" y="${headerY}" width="${colW}" height="${headerH}" fill="${COLORS.primary}"/>` +
    centerText(
      70 + colW / 2,
      headerY + headerH / 2 + 6,
      wrap(v.leftTitle, 50),
      {
        size: 18,
        weight: 700,
        fill: '#FFFFFF',
      },
    ) +
    centerText(
      70 + colW * 1.5,
      headerY + headerH / 2 + 6,
      wrap(v.rightTitle, 50),
      {
        size: 18,
        weight: 700,
        fill: '#FFFFFF',
      },
    );

  const rowY = headerY + headerH;
  const rowH = Math.min(70, (H - rowY - 40) / v.rows.length);
  v.rows.forEach((r, i) => {
    const y = rowY + i * rowH;
    if (i % 2 === 1) {
      body += `<rect x="70" y="${y}" width="${W - 140}" height="${rowH}" fill="#F8FAFC"/>`;
    }
    const lines = wrap(r.left, 42);
    const leftY = y + rowH / 2 - ((lines.length - 1) * 17) / 2 + 8;
    body += lines
      .map(
        (line, li) =>
          `<text x="92" y="${(leftY + li * 17).toFixed(1)}" font-size="14" fill="${COLORS.text}">${esc(
            line,
          )}</text>`,
      )
      .join('');
    const rightLines = wrap(r.right, 42);
    const rightY = y + rowH / 2 - ((rightLines.length - 1) * 17) / 2 + 8;
    body += rightLines
      .map(
        (line, li) =>
          `<text x="${70 + colW + 22}" y="${(rightY + li * 17).toFixed(1)}" font-size="14" fill="${COLORS.text}">${esc(
            line,
          )}</text>`,
      )
      .join('');
  });
  return `${titleSvg(v.title ?? '')}${body}`;
}

function renderConceptMap(v: ConceptMapVisual): string {
  const n = v.nodes.length;
  const cx = W / 2;
  const cy = H / 2 + 10;
  const r = n <= 5 ? 190 : n <= 6 ? 175 : 150;
  const nodeR = 54;
  const positions = new Map<string, { x: number; y: number }>();
  v.nodes.forEach((node, i) => {
    const angle = -Math.PI / 2 + (i / n) * Math.PI * 2;
    positions.set(node.id, {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    });
  });

  let body = '';
  const edgeLabel = (
    from: { x: number; y: number },
    to: { x: number; y: number },
    label?: string,
  ) => {
    if (!label) return '';
    const mx = (from.x + to.x) / 2;
    const my = (from.y + to.y) / 2;
    return centerText(mx, my + 4, wrap(label, 18), {
      size: 12,
      fill: COLORS.muted,
    });
  };

  v.edges.forEach((e) => {
    const from = positions.get(e.from);
    const to = positions.get(e.to);
    if (!from || !to) return;
    body += `<line x1="${from.x.toFixed(1)}" y1="${from.y.toFixed(1)}" x2="${to.x.toFixed(1)}" y2="${to.y.toFixed(1)}" stroke="${COLORS.border}" stroke-width="2.5"/>`;
    body += edgeLabel(from, to, e.label);
  });

  v.nodes.forEach((node) => {
    const p = positions.get(node.id);
    if (!p) return;
    const lines = wrap(node.label, 14);
    body += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${nodeR}" fill="${COLORS.nodeBg}" stroke="${COLORS.primary}" stroke-width="2.5"/>`;
    body += centerText(p.x, p.y, lines, {
      size: 14,
      weight: 700,
      fill: COLORS.text,
    });
  });

  return `${titleSvg(v.title ?? '')}${body}`;
}

export function renderVisualToSvg(visual: SlideVisual): string {
  let body = '';
  switch (visual.kind) {
    case 'bar':
    case 'line':
    case 'area':
    case 'pie':
      body = renderChart(visual);
      break;
    case 'flow':
      body = renderFlow(visual);
      break;
    case 'timeline':
      body = renderTimeline(visual);
      break;
    case 'comparison':
      body = renderComparison(visual);
      break;
    case 'concept_map':
      body = renderConceptMap(visual);
      break;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" ${FONT_ATTR}><rect width="${W}" height="${H}" fill="${COLORS.bg}"/>${body}</svg>`;
}

export function renderVisualToPng(visual: SlideVisual): Buffer {
  const svg = renderVisualToSvg(visual);
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1200 },
    background: COLORS.bg,
  });
  const png = resvg.render().asPng();
  return Buffer.from(png);
}

export function renderSlideVisuals(deck: Deck): (Buffer | null)[] {
  return deck.slides.map((slide) => {
    if (!slide.visual) return null;
    try {
      return renderVisualToPng(slide.visual);
    } catch {
      // A failed raster must never break the deck — the web viewer renders from the spec.
      return null;
    }
  });
}
