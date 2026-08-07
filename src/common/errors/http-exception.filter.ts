import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { ApiError, type ApiErrorBody } from './api-error';
import { ErrorCode } from './codes';
import { friendlyMessage, GENERIC_BACKEND_MESSAGES } from './friendly';
import type { ErrorHint } from './hints';

const GENERIC_MESSAGE_PATTERN =
  /^Cannot (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) /;

const CODE_BY_STATUS: Record<number, ErrorCode> = {
  400: ErrorCode.BAD_REQUEST,
  401: ErrorCode.UNAUTHORIZED,
  402: ErrorCode.PAYMENT_REQUIRED,
  403: ErrorCode.FORBIDDEN,
  404: ErrorCode.NOT_FOUND,
  409: ErrorCode.CONFLICT,
  429: ErrorCode.RATE_LIMITED,
};

const HINT_BY_STATUS: Partial<Record<number, ErrorHint>> = {
  401: 'RE_LOGIN',
  402: 'UPGRADE',
  429: 'RETRY',
};

const PRISMA_KNOWN_CODES: Record<string, { status: number; code: ErrorCode }> =
  {
    P2002: { status: HttpStatus.CONFLICT, code: ErrorCode.CONFLICT },
    P2003: { status: HttpStatus.CONFLICT, code: ErrorCode.CONFLICT },
    P2025: { status: HttpStatus.NOT_FOUND, code: ErrorCode.NOT_FOUND },
  };

interface ValidationDetail {
  field: string;
  message: string;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const envelope = this.toEnvelope(exception);

    if (envelope.statusCode >= 500) {
      this.logger.error(
        `Unhandled error (${envelope.code})`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    if (!response.headersSent) {
      response.status(envelope.statusCode).json(envelope);
    }
  }

  private toEnvelope(exception: unknown): ApiErrorBody {
    if (exception instanceof ApiError) {
      const body = exception.getResponse() as ApiErrorBody;
      if (
        exception.cause !== undefined &&
        process.env.NODE_ENV !== 'production'
      ) {
        return {
          ...body,
          dev: {
            ...this.devDetail(exception),
            cause: this.devDetail(exception.cause),
          },
        };
      }
      return this.withDev(body, exception);
    }

    if (exception instanceof HttpException) {
      return this.fromHttpException(exception);
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.fromPrisma(exception);
    }

    return this.internal(exception);
  }

  private fromHttpException(exception: HttpException): ApiErrorBody {
    const status = exception.getStatus();
    const raw = exception.getResponse();

    const rawIssues = Array.isArray(raw)
      ? raw
      : Array.isArray((raw as { message?: unknown })?.message)
        ? (raw as { message: unknown[] }).message
        : null;

    // nestjs-zod pipes throw BadRequestException with a ZodIssue array
    if (rawIssues) {
      return {
        statusCode: status,
        code: ErrorCode.VALIDATION_FAILED,
        message: friendlyMessage(status, ErrorCode.VALIDATION_FAILED),
        hint: null,
        details: rawIssues.map((issue): ValidationDetail => {
          const path = Array.isArray((issue as { path?: unknown })?.path)
            ? (issue as { path: (string | number)[] }).path.join('.')
            : '';
          return {
            field: path,
            message:
              (issue as { message?: string })?.message ?? 'Invalid value',
          };
        }),
      };
    }

    const message =
      typeof raw === 'string'
        ? raw
        : typeof (raw as { message?: unknown })?.message === 'string'
          ? (raw as { message: string }).message
          : undefined;

    const code = CODE_BY_STATUS[status] ?? ErrorCode.BAD_REQUEST;
    const hint = HINT_BY_STATUS[status] ?? null;

    if (
      !message ||
      GENERIC_BACKEND_MESSAGES.has(message) ||
      GENERIC_MESSAGE_PATTERN.test(message)
    ) {
      return this.withDev(
        {
          statusCode: status,
          code,
          message: friendlyMessage(status, code),
          hint,
        },
        exception,
      );
    }

    // Phase A: unconverted custom messages pass through verbatim
    return this.withDev({ statusCode: status, code, message, hint }, exception);
  }

  private fromPrisma(
    exception: Prisma.PrismaClientKnownRequestError,
  ): ApiErrorBody {
    const known = PRISMA_KNOWN_CODES[exception.code];
    if (known) {
      return this.withDev(
        {
          statusCode: known.status,
          code: known.code,
          message: friendlyMessage(known.status, known.code),
          hint: null,
        },
        exception,
      );
    }
    return this.internal(exception);
  }

  private internal(exception: unknown): ApiErrorBody {
    return this.withDev(
      {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        code: ErrorCode.INTERNAL_ERROR,
        message: friendlyMessage(
          HttpStatus.INTERNAL_SERVER_ERROR,
          ErrorCode.INTERNAL_ERROR,
        ),
        hint: 'RETRY',
      },
      exception,
    );
  }

  /** Appends debug detail in non-production environments only. */
  private withDev(body: ApiErrorBody, source: unknown): ApiErrorBody {
    if (process.env.NODE_ENV === 'production') return body;
    return { ...body, dev: this.devDetail(source) };
  }

  private devDetail(source: unknown): { error: string; stack?: string } {
    return {
      error:
        source instanceof Error
          ? `${source.name}: ${source.message}`
          : String(source),
      stack: source instanceof Error ? source.stack : undefined,
    };
  }
}
