export interface ScorePoint {
  studentId: string;
  submissionId: string;
  pct: number;
  createdAt: string;
}

export interface PctPoint {
  submissionId?: string;
  pct: number;
  createdAt: string;
}

export interface CriterionPoint {
  submissionId: string;
  criteriaId: string;
  criteriaDescription: string;
  pct: number;
  createdAt: string;
}

export type CriterionSeries = {
  criteriaId: string;
  criteriaDescription: string;
  points: PctPoint[];
};

export type CriterionStat = {
  criteriaId: string;
  criteriaDescription: string;
  count: number;
  last3AvgPct: number;
  consecutiveDrops: number;
};

export type StudentStats = {
  count: number;
  last3AvgPct: number;
  consecutiveDrops: number;
  deltaPct: number;
};

export type ClassStats = {
  studentCount: number;
  classAvgPct: number;
  droppingCount: number;
  belowAverageCount: number;
};

export type FlagType =
  'FAILING' | 'DOWNWARD_TREND' | 'CONSISTENT_STRUGGLE' | 'WEAK_CRITERION';
export type Attribution = 'STUDENT' | 'CLASS' | 'BOTH';

export type Verdict =
  | { flagged: false }
  | {
      flagged: true;
      type: FlagType;
      severity: 'MEDIUM' | 'HIGH';
      attribution: Attribution;
    };

export function scorePercentage(
  pointsAwarded: number,
  maxPoints: number,
): number {
  return maxPoints > 0 ? Math.round((pointsAwarded / maxPoints) * 100) : 0;
}

export function submissionPcts(rows: ScorePoint[]): PctPoint[] {
  const groups = new Map<string, { pcts: number[]; createdAt: string }>();
  for (const row of rows) {
    const existing = groups.get(row.submissionId);
    if (existing) {
      existing.pcts.push(row.pct);
      if (row.createdAt > existing.createdAt)
        existing.createdAt = row.createdAt;
    } else {
      groups.set(row.submissionId, {
        pcts: [row.pct],
        createdAt: row.createdAt,
      });
    }
  }

  return Array.from(groups.entries())
    .map(([submissionId, { pcts, createdAt }]): PctPoint => ({
      submissionId,
      pct: pcts.reduce((a, b) => a + b, 0) / pcts.length,
      createdAt,
    }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function submissionCriterionSeries(
  rows: CriterionPoint[],
): CriterionSeries[] {
  const groups = new Map<
    string,
    { criteriaDescription: string; points: PctPoint[] }
  >();
  for (const row of rows) {
    const existing = groups.get(row.criteriaId);
    const point: PctPoint = {
      submissionId: row.submissionId,
      pct: row.pct,
      createdAt: row.createdAt,
    };
    if (existing) {
      existing.points.push(point);
    } else {
      groups.set(row.criteriaId, {
        criteriaDescription: row.criteriaDescription,
        points: [point],
      });
    }
  }

  return Array.from(groups.entries()).map(
    ([criteriaId, { criteriaDescription, points }]) => ({
      criteriaId,
      criteriaDescription,
      points: points.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    }),
  );
}

export function criterionStatsFromSeries(
  series: CriterionSeries[],
): CriterionStat[] {
  return series.map((s) => {
    const stats = summarizeStudentSeries(s.points);
    return {
      criteriaId: s.criteriaId,
      criteriaDescription: s.criteriaDescription,
      count: stats.count,
      last3AvgPct: stats.last3AvgPct,
      consecutiveDrops: stats.consecutiveDrops,
    };
  });
}

export function weakCriterion(
  criteriaStats: CriterionStat[],
  threshold = 60,
  minCount = 2,
): CriterionStat[] {
  return criteriaStats
    .filter((c) => c.last3AvgPct < threshold && c.count >= minCount)
    .sort((a, b) => a.last3AvgPct - b.last3AvgPct);
}

export function summarizeStudentSeries(points: PctPoint[]): StudentStats {
  if (points.length === 0) {
    return {
      count: 0,
      last3AvgPct: 0,
      consecutiveDrops: 0,
      deltaPct: 0,
    };
  }

  const last3 = points.slice(-3);
  const last3AvgPct = last3.reduce((a, b) => a + b.pct, 0) / last3.length;

  let consecutiveDrops = 0;
  for (let i = points.length - 1; i > 0; i--) {
    if (points[i].pct < points[i - 1].pct) consecutiveDrops++;
    else break;
  }

  const deltaPct =
    points.length >= 2
      ? points[points.length - 1].pct - points[points.length - 2].pct
      : 0;

  return {
    count: points.length,
    last3AvgPct,
    consecutiveDrops,
    deltaPct,
  };
}

export function summarizeClass(pointsByStudent: PctPoint[][]): ClassStats {
  const series = pointsByStudent
    .filter((p) => p.length > 0)
    .map((p) => summarizeStudentSeries(p));

  if (series.length === 0) {
    return {
      studentCount: 0,
      classAvgPct: 0,
      droppingCount: 0,
      belowAverageCount: 0,
    };
  }

  const classAvgPct =
    series.reduce((a, s) => a + s.last3AvgPct, 0) / series.length;

  return {
    studentCount: series.length,
    classAvgPct: Math.round(classAvgPct),
    droppingCount: series.filter((s) => s.consecutiveDrops >= 2).length,
    belowAverageCount: series.filter((s) => s.last3AvgPct < 60).length,
  };
}

export function attribution(
  student: StudentStats,
  klass: ClassStats,
): Attribution {
  const classWide = klass.studentCount >= 2;
  const classDropping =
    classWide && klass.droppingCount / klass.studentCount >= 0.5;
  const studentDropping = student.consecutiveDrops >= 2;

  if (studentDropping && classDropping) return 'BOTH';
  if (classDropping) return 'CLASS';
  return 'STUDENT';
}

export function verdict(
  student: StudentStats,
  klass: ClassStats | null,
  recentlyFlagged: boolean,
): Verdict {
  const dropsTrigger = student.consecutiveDrops >= 3;

  if (student.count < 2 || (student.last3AvgPct >= 60 && !dropsTrigger)) {
    return { flagged: false };
  }

  const type: FlagType =
    student.last3AvgPct < 60
      ? recentlyFlagged
        ? 'CONSISTENT_STRUGGLE'
        : 'FAILING'
      : recentlyFlagged
        ? 'CONSISTENT_STRUGGLE'
        : 'DOWNWARD_TREND';

  return {
    flagged: true,
    type,
    severity: type === 'FAILING' ? 'HIGH' : 'MEDIUM',
    attribution: klass ? attribution(student, klass) : 'STUDENT',
  };
}
