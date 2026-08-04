import {
  avgPercentage,
  bucketize,
  bucketizePercent,
  bucketizeRates,
  bucketStarts,
  computeDelta,
} from './insights.util';

describe('insights.util', () => {
  const NOW = new Date('2026-08-03T12:00:00Z');

  describe('bucketStarts', () => {
    it('returns count weekly starts, oldest first, aligned to Monday', () => {
      const starts = bucketStarts('week', 3, NOW);
      expect(starts).toHaveLength(3);
      expect(starts[0].toISOString()).toBe('2026-07-20T00:00:00.000Z');
      expect(starts[1].toISOString()).toBe('2026-07-27T00:00:00.000Z');
      expect(starts[2].toISOString()).toBe('2026-08-03T00:00:00.000Z');
    });

    it('returns count monthly starts, oldest first, aligned to the 1st', () => {
      const starts = bucketStarts('month', 3, NOW);
      expect(starts).toHaveLength(3);
      expect(starts[0].toISOString()).toBe('2026-06-01T00:00:00.000Z');
      expect(starts[1].toISOString()).toBe('2026-07-01T00:00:00.000Z');
      expect(starts[2].toISOString()).toBe('2026-08-01T00:00:00.000Z');
    });
  });

  describe('bucketize', () => {
    it('counts rows into the correct weekly buckets', () => {
      const rows = [
        { createdAt: new Date('2026-07-27T10:00:00Z') },
        { createdAt: new Date('2026-08-03T01:00:00Z') },
        { createdAt: new Date('2026-08-03T23:00:00Z') },
      ];
      const series = bucketize(rows, 'week', 3, NOW);
      expect(series).toEqual([
        { label: '2026-07-20', value: 0 },
        { label: '2026-07-27', value: 1 },
        { label: '2026-08-03', value: 2 },
      ]);
    });

    it('returns empty buckets for empty input', () => {
      const series = bucketize([], 'week', 3, NOW);
      expect(series).toEqual([
        { label: '2026-07-20', value: 0 },
        { label: '2026-07-27', value: 0 },
        { label: '2026-08-03', value: 0 },
      ]);
    });

    it('counts a single row in the right monthly bucket', () => {
      const rows = [{ createdAt: new Date('2026-07-15T12:00:00Z') }];
      const series = bucketize(rows, 'month', 3, NOW);
      expect(series[1]).toEqual({ label: '2026-07-01', value: 1 });
      expect(series[0]).toEqual({ label: '2026-06-01', value: 0 });
    });

    it('ignores rows older than the window', () => {
      const rows = [{ createdAt: new Date('2026-07-01T12:00:00Z') }];
      const series = bucketize(rows, 'week', 3, NOW);
      expect(series).toEqual([
        { label: '2026-07-20', value: 0 },
        { label: '2026-07-27', value: 0 },
        { label: '2026-08-03', value: 0 },
      ]);
    });
  });

  describe('bucketizeRates', () => {
    it('computes present rate per bucket as 0-100', () => {
      const rows = [
        { date: new Date('2026-07-27T09:00:00Z'), present: true },
        { date: new Date('2026-07-27T10:00:00Z'), present: false },
        { date: new Date('2026-08-03T09:00:00Z'), present: true },
      ];
      const series = bucketizeRates(rows, 'week', 3, NOW);
      expect(series[1].value).toBe(50);
      expect(series[2].value).toBe(100);
    });

    it('returns 0 for buckets with no attendance', () => {
      const series = bucketizeRates([], 'week', 3, NOW);
      expect(series.every((p) => p.value === 0)).toBe(true);
    });
  });

  describe('bucketizePercent', () => {
    it('averages percentages per bucket', () => {
      const rows = [
        { createdAt: new Date('2026-07-27T09:00:00Z'), pct: 80 },
        { createdAt: new Date('2026-07-27T10:00:00Z'), pct: 40 },
      ];
      const series = bucketizePercent(rows, 'week', 3, NOW);
      expect(series[1].value).toBe(60);
    });
  });

  describe('computeDelta', () => {
    it('is up when current exceeds previous', () => {
      expect(computeDelta(10, 5)).toEqual({
        deltaPercent: 100,
        direction: 'up',
      });
    });

    it('is down when current is below previous', () => {
      expect(computeDelta(5, 10)).toEqual({
        deltaPercent: -50,
        direction: 'down',
      });
    });

    it('rounds to one decimal', () => {
      expect(computeDelta(7.5, 10)).toEqual({
        deltaPercent: -25,
        direction: 'down',
      });
    });

    it('is flat when both are zero (no division by zero)', () => {
      expect(computeDelta(0, 0)).toEqual({
        deltaPercent: 0,
        direction: 'flat',
      });
    });

    it('is up 100% when previous is zero and current grew (no division by zero)', () => {
      expect(computeDelta(5, 0)).toEqual({
        deltaPercent: 100,
        direction: 'up',
      });
    });

    it('is flat when values are equal', () => {
      expect(computeDelta(10, 10)).toEqual({
        deltaPercent: 0,
        direction: 'flat',
      });
    });
  });

  describe('avgPercentage', () => {
    it('returns the rounded average of ratios as 0-100', () => {
      expect(
        avgPercentage([
          { pointsAwarded: 10, maxPoints: 20 },
          { pointsAwarded: 20, maxPoints: 20 },
        ]),
      ).toBe(75);
    });

    it('returns 0 for empty input', () => {
      expect(avgPercentage([])).toBe(0);
    });

    it('ignores zero-max scores and returns 0 when none qualify', () => {
      expect(avgPercentage([{ pointsAwarded: 5, maxPoints: 0 }])).toBe(0);
    });
  });
});
