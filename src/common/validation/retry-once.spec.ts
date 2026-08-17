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

  it('should retry twice when attempts is 3 then succeed', async () => {
    const invalid = { name: 123, score: 'bad' };
    const retryFn = jest
      .fn()
      .mockResolvedValueOnce({ name: 'bad', score: 'bad' })
      .mockResolvedValueOnce({ name: 'retried', score: 75 });

    const result = await validateWithRetry(schema, invalid, retryFn, 3);

    expect(retryFn).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ name: 'retried', score: 75 });
  });

  it('should pass a feedback string describing the rejection to retryFn', async () => {
    const invalid = { name: 123, score: 'bad' };
    const retryFn = jest.fn<Promise<unknown>, [feedback?: string]>();
    retryFn.mockResolvedValue({ name: 'retried', score: 75 });

    await validateWithRetry(schema, invalid, retryFn);

    expect(retryFn).toHaveBeenCalledTimes(1);
    const feedback = retryFn.mock.calls[0]?.[0];
    expect(feedback).toEqual(expect.any(String));
    expect(feedback).toContain('Schema mismatch');
  });

  it('should pass the model parse error back as feedback when retryFn rejects', async () => {
    const invalid = { name: 123, score: 'bad' };
    const retryFn = jest.fn<Promise<unknown>, [feedback?: string]>();
    retryFn
      .mockRejectedValueOnce(new SyntaxError("Unexpected token 'B'"))
      .mockResolvedValueOnce({ name: 'retried', score: 75 });

    const result = await validateWithRetry(schema, invalid, retryFn, 3);

    expect(result).toEqual({ name: 'retried', score: 75 });
    expect(retryFn).toHaveBeenCalledTimes(2);
    expect(retryFn.mock.calls[1]?.[0]).toContain("Unexpected token 'B'");
  });

  it('should report 3 attempts when attempts is 3 and all fail', async () => {
    const invalid = { name: 123, score: 'bad' };
    const retryFn = jest
      .fn()
      .mockResolvedValue({ name: 456, score: 'also bad' });

    try {
      await validateWithRetry(schema, invalid, retryFn, 3);
      fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).attempts).toBe(3);
      expect(retryFn).toHaveBeenCalledTimes(2);
    }
  });
});
