import { shouldFlagStudent } from './threshold';

describe('shouldFlagStudent', () => {
  it('flags FAILING when average of last 3 is below 60%', () => {
    const result = shouldFlagStudent([80, 50, 45]);
    expect(result).toEqual({ flagged: true, type: 'FAILING' });
  });

  it('flags DOWNWARD_TREND when last 2 grades both drop', () => {
    const result = shouldFlagStudent([80, 75, 70]);
    expect(result).toEqual({ flagged: true, type: 'DOWNWARD_TREND' });
  });

  it('does not flag when grades are stable', () => {
    const result = shouldFlagStudent([80, 85, 82]);
    expect(result).toEqual({ flagged: false });
  });

  it('does not flag with fewer than 3 grades', () => {
    expect(shouldFlagStudent([90])).toEqual({ flagged: false });
    expect(shouldFlagStudent([80, 85])).toEqual({ flagged: false });
  });

  it('does not flag with empty array', () => {
    expect(shouldFlagStudent([])).toEqual({ flagged: false });
  });

  it('prefers FAILING over DOWNWARD_TREND when avg < 60%', () => {
    const result = shouldFlagStudent([50, 55, 40]);
    expect(result).toEqual({ flagged: true, type: 'FAILING' });
  });

  it('does not flag upward trend (improving)', () => {
    const result = shouldFlagStudent([60, 70, 80]);
    expect(result).toEqual({ flagged: false });
  });

  it('does not flag when drop is not consecutive', () => {
    const result = shouldFlagStudent([70, 80, 75]);
    expect(result).toEqual({ flagged: false });
  });
});
