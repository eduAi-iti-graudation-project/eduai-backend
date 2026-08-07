import { HttpException } from '@nestjs/common';
import type { ErrorCode } from './codes';
import type { ErrorHint } from './hints';
export interface ApiErrorOptions {
  hint?: ErrorHint | null;
  details?: unknown;
  /** Original error — surfaced in the dev payload for debugging, never in prod. */
  cause?: unknown;
}

export interface ApiErrorBody {
  statusCode: number;
  code: ErrorCode;
  message: string;
  hint: ErrorHint | null;
  details?: unknown;
  dev?: {
    error: string;
    stack?: string;
    cause?: { error: string; stack?: string };
  };
}

/**
 * Application error carrying a stable machine-readable code plus a
 * human-friendly message and an optional action hint. The global
 * HttpExceptionFilter renders it as the API error envelope.
 */
export class ApiError extends HttpException {
  readonly code: ErrorCode;
  readonly hint: ErrorHint | null;
  readonly details?: unknown;
  readonly cause: unknown;

  constructor(
    code: ErrorCode,
    status: number,
    message: string,
    options: ApiErrorOptions = {},
  ) {
    super(
      {
        statusCode: status,
        code,
        message,
        hint: options.hint ?? null,
        ...(options.details !== undefined ? { details: options.details } : {}),
      },
      status,
      options.cause !== undefined ? { cause: options.cause } : undefined,
    );
    this.code = code;
    this.hint = options.hint ?? null;
    if (options.details !== undefined) this.details = options.details;
    this.cause = options.cause ?? null;
  }
}
