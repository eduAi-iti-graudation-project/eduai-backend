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
): Promise<T> {
  try {
    return schema.parse(data);
  } catch (firstError) {
    try {
      const retried = await retryFn();
      return schema.parse(retried);
    } catch (secondError) {
      const message =
        secondError instanceof ZodError
          ? `Schema validation failed after retry: ${secondError.message}`
          : `Validation failed after retry: ${String(secondError)}`;
      const errors = {
        first: firstError as Error,
        second: secondError as Error,
      };
      throw new ValidationError(message, errors, 2);
    }
  }
}
