import { GradingOutputSchema } from './dto';

describe('GradingOutputSchema', () => {
  const uuid1 = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  const uuid2 = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';

  const validOutput = {
    scores: [
      {
        criterionId: uuid1,
        pointsAwarded: 8,
        feedback: 'Good thesis statement',
      },
      { criterionId: uuid2, pointsAwarded: 12, feedback: 'Strong evidence' },
    ],
    overallFeedback: 'Well done overall',
  };

  it('accepts a valid grading output', () => {
    const result = GradingOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
  });

  it('rejects empty scores array', () => {
    const result = GradingOutputSchema.safeParse({
      ...validOutput,
      scores: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative pointsAwarded', () => {
    const result = GradingOutputSchema.safeParse({
      ...validOutput,
      scores: [{ ...validOutput.scores[0], pointsAwarded: -1 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing feedback', () => {
    const result = GradingOutputSchema.safeParse({
      ...validOutput,
      scores: [{ criterionId: uuid1, pointsAwarded: 8 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-uuid criterionId', () => {
    const result = GradingOutputSchema.safeParse({
      ...validOutput,
      scores: [{ ...validOutput.scores[0], criterionId: 'not-a-uuid' }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts output without overallFeedback', () => {
    const result = GradingOutputSchema.safeParse({
      scores: validOutput.scores,
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-integer pointsAwarded', () => {
    const result = GradingOutputSchema.safeParse({
      ...validOutput,
      scores: [{ ...validOutput.scores[0], pointsAwarded: 8.5 }],
    });
    expect(result.success).toBe(false);
  });
});
