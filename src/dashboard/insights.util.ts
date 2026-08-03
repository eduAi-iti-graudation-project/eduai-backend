export type InsightsInterval = 'week' | 'month';
export type ChartType = 'line' | 'area' | 'bar' | 'radar' | 'donut';
export type DeltaDirection = 'up' | 'down' | 'flat';

export interface SeriesPoint {
  label: string;
  value: number;
}

export interface Delta {
  deltaPercent: number;
  direction: DeltaDirection;
}

/**
 * UTC bucket starts for the trailing `count` periods (oldest first).
 * Weeks start on Monday; months start on the 1st.
 */
export function bucketStarts(
  interval: InsightsInterval,
  count: number,
  now: Date = new Date(),
): Date[] {
  const starts: Date[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now);
    if (interval === 'week') {
      const dayFromMonday = (d.getUTCDay() + 6) % 7;
      d.setUTCDate(d.getUTCDate() - dayFromMonday - i * 7);
    } else {
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() - i);
    }
    d.setUTCHours(0, 0, 0, 0);
    starts.push(d);
  }
  return starts;
}

function assignBucket(starts: Date[], time: number): number {
  let idx = -1;
  for (let i = 0; i < starts.length; i++) {
    if (time >= starts[i].getTime()) idx = i;
  }
  return idx;
}

/** Count rows per bucket. Rows older than the window are ignored. */
export function bucketize(
  rows: { createdAt: Date }[],
  interval: InsightsInterval,
  count = 12,
  now: Date = new Date(),
): SeriesPoint[] {
  const starts = bucketStarts(interval, count, now);
  const buckets: SeriesPoint[] = starts.map((s) => ({
    label: s.toISOString().slice(0, 10),
    value: 0,
  }));
  for (const row of rows) {
    const idx = assignBucket(starts, row.createdAt.getTime());
    if (idx >= 0) buckets[idx].value += 1;
  }
  return buckets;
}

/** Attendance rate (present / total, as a 0-100 %) per bucket. */
export function bucketizeRates(
  rows: { date: Date; present: boolean }[],
  interval: InsightsInterval,
  count = 12,
  now: Date = new Date(),
): SeriesPoint[] {
  const starts = bucketStarts(interval, count, now);
  const totals = starts.map(() => 0);
  const present = starts.map(() => 0);
  for (const row of rows) {
    const idx = assignBucket(starts, row.date.getTime());
    if (idx >= 0) {
      totals[idx] += 1;
      if (row.present) present[idx] += 1;
    }
  }
  return starts.map((s, i) => ({
    label: s.toISOString().slice(0, 10),
    value: totals[i] > 0 ? Math.round((present[i] / totals[i]) * 1000) / 10 : 0,
  }));
}

/** Average percentage (0-100, one decimal) per bucket. */
export function bucketizePercent(
  rows: { createdAt: Date; pct: number }[],
  interval: InsightsInterval,
  count = 12,
  now: Date = new Date(),
): SeriesPoint[] {
  const starts = bucketStarts(interval, count, now);
  const totals = starts.map(() => 0);
  const sum = starts.map(() => 0);
  for (const row of rows) {
    const idx = assignBucket(starts, row.createdAt.getTime());
    if (idx >= 0) {
      totals[idx] += 1;
      sum[idx] += row.pct;
    }
  }
  return starts.map((s, i) => ({
    label: s.toISOString().slice(0, 10),
    value: totals[i] > 0 ? Math.round((sum[i] / totals[i]) * 10) / 10 : 0,
  }));
}

/**
 * Signed percent change between two window sums.
 * Never divides by zero: both zero → flat; previous zero with growth → 100% up.
 */
export function computeDelta(current: number, previous: number): Delta {
  if (previous === 0) {
    return current > 0
      ? { deltaPercent: 100, direction: 'up' }
      : { deltaPercent: 0, direction: 'flat' };
  }
  if (current === previous) {
    return { deltaPercent: 0, direction: 'flat' };
  }
  const pct = ((current - previous) / previous) * 100;
  return {
    deltaPercent: Math.round(pct * 10) / 10,
    direction: pct > 0 ? 'up' : 'down',
  };
}

/** Average of score ratios as a 0-100 percentage (one decimal). Empty → 0. */
export function avgPercentage(
  scores: { pointsAwarded: number; maxPoints: number }[],
): number {
  if (scores.length === 0) return 0;
  const ratios = scores
    .filter((s) => s.maxPoints > 0)
    .map((s) => s.pointsAwarded / s.maxPoints);
  if (ratios.length === 0) return 0;
  return (
    Math.round((ratios.reduce((a, b) => a + b, 0) / ratios.length) * 1000) / 10
  );
}
