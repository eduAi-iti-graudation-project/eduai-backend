export type FlagType = 'FAILING' | 'DOWNWARD_TREND';

export type FlagResult = { flagged: false } | { flagged: true; type: FlagType };

export function shouldFlagStudent(percentageGrades: number[]): FlagResult {
  if (percentageGrades.length < 3) return { flagged: false };

  const last3 = percentageGrades.slice(-3);
  const avg = last3.reduce((a, b) => a + b, 0) / last3.length;

  if (avg < 60) return { flagged: true, type: 'FAILING' };

  if (last3[0] > last3[1] && last3[1] > last3[2]) {
    return { flagged: true, type: 'DOWNWARD_TREND' };
  }

  return { flagged: false };
}
