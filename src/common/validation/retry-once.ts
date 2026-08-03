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

export async function validateWithRetry<T>(
  schema: ZodSchema<T>,
  data: unknown,
  retryFn: () => Promise<unknown>,
  attempts = 2,
): Promise<T> {
  let firstError: unknown;

  for (let i = 0; i < attempts; i++) {
    try {
      return schema.parse(data);
    } catch (error) {
      if (i === 0) firstError = error;
      if (i === attempts - 1) {
        const message =
          error instanceof ZodError
            ? `Schema validation failed after retry: ${error.message}`
            : `Validation failed after retry: ${String(error)}`;
        throw new ValidationError(
          message,
          {
            first: firstError as Error,
            second: error as Error,
          },
          attempts,
        );
      }
      try {
        data = await retryFn();
      } catch (retryError) {
        if (i + 1 >= attempts - 1) {
          throw new ValidationError(
            `Validation failed after retry: ${String(retryError)}`,
            {
              first: error as Error,
              second: retryError as Error,
            },
            attempts,
          );
        }
      }
    }
  }

  throw new Error('validateWithRetry: unreachable');
}
