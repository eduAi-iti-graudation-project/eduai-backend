import {
  submissionPcts,
  summarizeStudentSeries,
  summarizeClass,
  attribution,
  verdict,
  submissionCriterionSeries,
  criterionStatsFromSeries,
  weakCriterion,
} from './trends';

const iso = (offset: number) =>
  new Date(Date.UTC(2026, 0, 1 + offset)).toISOString();

describe('submissionPcts', () => {
  it('averages multiple criteria into a per-submission point and sorts chronologically', () => {
    const rows = [
      { studentId: 's1', submissionId: 'sub-2', pct: 80, createdAt: iso(2) },
      { studentId: 's1', submissionId: 'sub-1', pct: 100, createdAt: iso(1) },
      { studentId: 's1', submissionId: 'sub-1', pct: 60, createdAt: iso(1) },
    ];

    const result = submissionPcts(rows);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      submissionId: 'sub-1',
      pct: 80,
      createdAt: iso(1),
    });
    expect(result[1]).toEqual({
      submissionId: 'sub-2',
      pct: 80,
      createdAt: iso(2),
    });
  });
});

describe('summarizeStudentSeries', () => {
  it('returns zeroed stats on empty input', () => {
    expect(summarizeStudentSeries([])).toEqual({
      count: 0,
      last3AvgPct: 0,
      consecutiveDrops: 0,
      deltaPct: 0,
    });
  });

  it('computes last-3 average, consecutive drops and delta', () => {
    const points = [90, 80, 70, 40].map((pct, i) => ({
      pct,
      createdAt: iso(i),
    }));

    const stats = summarizeStudentSeries(points);

    expect(stats.count).toBe(4);
    expect(stats.last3AvgPct).toBeCloseTo(63.33, 1);
    expect(stats.consecutiveDrops).toBe(3);
    expect(stats.deltaPct).toBe(-30);
  });

  it('stops counting consecutive drops on an increase', () => {
    const points = [80, 90, 85, 88, 60].map((pct, i) => ({
      pct,
      createdAt: iso(i),
    }));

    const stats = summarizeStudentSeries(points);

    expect(stats.consecutiveDrops).toBe(1);
  });
});

describe('submissionCriterionSeries', () => {
  it('groups rows by criteriaId and sorts each series chronologically', () => {
    const rows = [
      {
        submissionId: 'sub-2',
        criteriaId: 'c-evidence',
        criteriaDescription: 'Using evidence',
        pct: 20,
        createdAt: iso(2),
      },
      {
        submissionId: 'sub-1',
        criteriaId: 'c-argument',
        criteriaDescription: 'Argument',
        pct: 90,
        createdAt: iso(1),
      },
      {
        submissionId: 'sub-1',
        criteriaId: 'c-evidence',
        criteriaDescription: 'Using evidence',
        pct: 10,
        createdAt: iso(1),
      },
      {
        submissionId: 'sub-2',
        criteriaId: 'c-argument',
        criteriaDescription: 'Argument',
        pct: 95,
        createdAt: iso(2),
      },
    ];

    const series = submissionCriterionSeries(rows);

    expect(series).toHaveLength(2);
    const evidence = series.find((s) => s.criteriaId === 'c-evidence');
    expect(evidence?.criteriaDescription).toBe('Using evidence');
    expect(evidence?.points).toEqual([
      { submissionId: 'sub-1', pct: 10, createdAt: iso(1) },
      { submissionId: 'sub-2', pct: 20, createdAt: iso(2) },
    ]);
  });

  it('handles empty input', () => {
    expect(submissionCriterionSeries([])).toEqual([]);
  });
});

describe('criterionStatsFromSeries', () => {
  it('summarizes every criterion series', () => {
    const series = [
      {
        criteriaId: 'c-evidence',
        criteriaDescription: 'Using evidence',
        points: [
          { submissionId: 'sub-1', pct: 10, createdAt: iso(1) },
          { submissionId: 'sub-2', pct: 20, createdAt: iso(2) },
        ],
      },
      {
        criteriaId: 'c-argument',
        criteriaDescription: 'Argument',
        points: [
          { submissionId: 'sub-1', pct: 90, createdAt: iso(1) },
          { submissionId: 'sub-2', pct: 95, createdAt: iso(2) },
        ],
      },
    ];

    const stats = criterionStatsFromSeries(series);

    expect(stats).toHaveLength(2);
    const evidence = stats.find((s) => s.criteriaId === 'c-evidence');
    expect(evidence?.count).toBe(2);
    expect(evidence?.last3AvgPct).toBeCloseTo(15, 1);
    expect(evidence?.consecutiveDrops).toBe(0);
  });
});

describe('weakCriterion', () => {
  const stats = (
    overrides: Partial<Parameters<typeof weakCriterion>[0][0]>,
  ) => {
    const base = {
      criteriaId: 'c-evidence',
      criteriaDescription: 'Using evidence',
      count: 2,
      last3AvgPct: 20,
      consecutiveDrops: 0,
    };
    return { ...base, ...overrides };
  };

  it('returns criteria whose last-3 average is below the threshold', () => {
    const result = weakCriterion([
      stats({ last3AvgPct: 20 }),
      stats({ criteriaId: 'c-argument', last3AvgPct: 85 }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].criteriaId).toBe('c-evidence');
  });

  it('sorts weak criteria from weakest first', () => {
    const result = weakCriterion([
      stats({ criteriaId: 'c-a', last3AvgPct: 40 }),
      stats({ criteriaId: 'c-b', last3AvgPct: 20 }),
    ]);

    expect(result.map((c) => c.criteriaId)).toEqual(['c-b', 'c-a']);
  });

  it('ignores criteria with fewer than the minimum data points', () => {
    const result = weakCriterion([stats({ count: 1, last3AvgPct: 10 })]);

    expect(result).toEqual([]);
  });

  it('does not flag a criterion exactly at the threshold', () => {
    const result = weakCriterion([stats({ last3AvgPct: 60 })]);

    expect(result).toEqual([]);
  });
});

describe('summarizeClass', () => {
  it('aggregates student series into class stats', () => {
    const result = summarizeClass([
      [90, 80, 70].map((pct, i) => ({ pct, createdAt: iso(i) })),
      [60, 50, 40].map((pct, i) => ({ pct, createdAt: iso(i) })),
      [75, 78, 74].map((pct, i) => ({ pct, createdAt: iso(i) })),
    ]);

    expect(result.studentCount).toBe(3);
    expect(result.droppingCount).toBe(2);
    expect(result.belowAverageCount).toBe(1);
    expect(result.classAvgPct).toBe(Math.round((80 + 50 + 75.67) / 3));
  });

  it('handles empty input', () => {
    expect(summarizeClass([[], []])).toEqual({
      studentCount: 0,
      classAvgPct: 0,
      droppingCount: 0,
      belowAverageCount: 0,
    });
  });
});

describe('attribution', () => {
  it('returns STUDENT when only the student is declining', () => {
    const student = { consecutiveDrops: 2 } as never;
    const klass = { studentCount: 4, droppingCount: 1 } as never;

    expect(attribution(student, klass)).toBe('STUDENT');
  });

  it('returns CLASS when the class is dropping but the student is not', () => {
    const student = { consecutiveDrops: 0 } as never;
    const klass = { studentCount: 4, droppingCount: 3 } as never;

    expect(attribution(student, klass)).toBe('CLASS');
  });

  it('returns BOTH when student and most of the class decline', () => {
    const student = { consecutiveDrops: 2 } as never;
    const klass = { studentCount: 4, droppingCount: 3 } as never;

    expect(attribution(student, klass)).toBe('BOTH');
  });

  it('never reports CLASS for a tiny class', () => {
    const student = { consecutiveDrops: 0 } as never;
    const klass = { studentCount: 1, droppingCount: 1 } as never;

    expect(attribution(student, klass)).toBe('STUDENT');
  });
});

describe('verdict', () => {
  it('returns not flagged when there is insufficient data', () => {
    const student = {
      count: 1,
      last3AvgPct: 50,
      consecutiveDrops: 0,
      deltaPct: 0,
    } as never;

    expect(verdict(student, null, false)).toEqual({ flagged: false });
  });

  it('flags FAILING when the last-3 average is below 60', () => {
    const student = {
      count: 3,
      last3AvgPct: 55,
      consecutiveDrops: 1,
      deltaPct: -5,
    } as never;

    expect(verdict(student, null, false)).toEqual({
      flagged: true,
      type: 'FAILING',
      severity: 'HIGH',
      attribution: 'STUDENT',
    });
  });

  it('flags DOWNWARD_TREND on 3 consecutive drops even with average above 60', () => {
    const student = {
      count: 4,
      last3AvgPct: 70,
      consecutiveDrops: 3,
      deltaPct: -30,
    } as never;

    expect(verdict(student, null, false)).toEqual({
      flagged: true,
      type: 'DOWNWARD_TREND',
      severity: 'MEDIUM',
      attribution: 'STUDENT',
    });
  });

  it('upgrades to CONSISTENT_STRUGGLE when the student was recently flagged', () => {
    const student = {
      count: 3,
      last3AvgPct: 55,
      consecutiveDrops: 1,
      deltaPct: -5,
    } as never;

    expect(verdict(student, null, true)).toEqual({
      flagged: true,
      type: 'CONSISTENT_STRUGGLE',
      severity: 'MEDIUM',
      attribution: 'STUDENT',
    });
  });

  it('stays unflagged with a healthy steady average', () => {
    const student = {
      count: 3,
      last3AvgPct: 80,
      consecutiveDrops: 0,
      deltaPct: 0,
    } as never;

    expect(verdict(student, null, false)).toEqual({ flagged: false });
  });
});
