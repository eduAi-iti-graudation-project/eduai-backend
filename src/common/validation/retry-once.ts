import { ZodError, ZodSchema } from 'zod';

export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly cause: unknown,
    public readonly attempts: number,
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

function feedbackFor(error: unknown): string {
  if (error instanceof ZodError) {
    const first = error.issues[0];
    if (first) {
      const path = first.path?.length ? `"${first.path.join('.')}" ` : '';
      return `Schema mismatch: ${path}${first.message}${
        'received' in first
          ? ` (received ${JSON.stringify(first.received)})`
          : ''
      }`;
    }
    return 'The response did not match the expected schema.';
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function validateWithRetry<T>(
  schema: ZodSchema<T>,
  data: unknown,
  retryFn: (feedback?: string) => Promise<unknown>,
  attempts = 2,
): Promise<T> {
  let firstError: unknown;
  let current = data;
  let lastError: unknown;

  for (let i = 0; i < attempts; i++) {
    let parseError: unknown;
    try {
      return schema.parse(current);
    } catch (error) {
      parseError = error;
    }

    if (i === 0) firstError = parseError;

    // Surface the most recent rejection reason — a parse failure from the
    // model's last attempt if there was one, otherwise the schema mismatch.
    const feedback = feedbackFor(lastError ?? parseError);

    if (i === attempts - 1) {
      const final = lastError ?? parseError;
      const message =
        final instanceof ZodError
          ? `Schema validation failed after retry: ${final.message}`
          : `Validation failed after retry: ${String(final)}`;
      throw new ValidationError(
        message,
        {
          first: firstError as Error,
          second: final as Error,
        },
        attempts,
      );
    }

    try {
      current = await retryFn(feedback);
      lastError = undefined;
    } catch (retryError) {
      lastError = retryError;
    }
  }

  throw new Error('validateWithRetry: unreachable');
}
