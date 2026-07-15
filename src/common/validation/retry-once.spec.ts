import { z } from 'zod';
import { validateWithRetry, ValidationError } from './retry-once';

describe('validateWithRetry', () => {
  const schema = z.object({
    name: z.string(),
    score: z.number().min(0).max(100),
  });

  it('should succeed on first valid data', async () => {
    const data = { name: 'test', score: 85 };
    const result = await validateWithRetry(schema, data, () =>
      Promise.resolve({ name: '', score: 0 }),
    );
    expect(result).toEqual(data);
  });

  it('should retry once on invalid data then succeed', async () => {
    const invalid = { name: 123, score: 'bad' };
    const retryFn = jest.fn().mockResolvedValue({ name: 'retried', score: 75 });

    const result = await validateWithRetry(schema, invalid, retryFn);

    expect(retryFn).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ name: 'retried', score: 75 });
  });

  it('should throw ValidationError after retry also fails', async () => {
    const invalid = { name: 123, score: 'bad' };
    const retryFn = jest
      .fn()
      .mockResolvedValue({ name: 456, score: 'also bad' });

    await expect(validateWithRetry(schema, invalid, retryFn)).rejects.toThrow(
      ValidationError,
    );
    expect(retryFn).toHaveBeenCalledTimes(1);
  });

  it('should throw ValidationError when retryFn rejects', async () => {
    const invalid = { name: 123, score: 'bad' };
    const retryFn = jest.fn().mockRejectedValue(new Error('API error'));

    await expect(validateWithRetry(schema, invalid, retryFn)).rejects.toThrow(
      ValidationError,
    );
  });

  it('should report 2 attempts in the error', async () => {
    const invalid = { name: 123, score: 'bad' };
    const retryFn = jest
      .fn()
      .mockResolvedValue({ name: 456, score: 'also bad' });

    try {
      await validateWithRetry(schema, invalid, retryFn);
      fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).attempts).toBe(2);
    }
  });
});
