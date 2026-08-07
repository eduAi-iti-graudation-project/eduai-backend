import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { ApiError } from './api-error';
import { ErrorCode } from './codes';
import { HttpExceptionFilter } from './http-exception.filter';

class HttpExceptionImpl extends HttpException {}

function makeHost(bodySink: { body: unknown; status: number }) {
  const self = {
    status(status: number) {
      bodySink.status = status;
      return self;
    },
    json(body: unknown) {
      bodySink.body = body;
      return self;
    },
    headersSent: false,
  };

  return {
    switchToHttp: () => ({
      getResponse: () => self as unknown as Response,
    }),
  } as unknown as Parameters<HttpExceptionFilter['catch']>[1];
}

function runFilter(exception: unknown) {
  const sink = { body: undefined, status: 0 };
  new HttpExceptionFilter().catch(exception, makeHost(sink));
  return {
    body: (sink.body ?? {}) as Record<string, unknown>,
    status: sink.status,
  };
}

describe('HttpExceptionFilter', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  describe('ApiError', () => {
    it('emits the stable envelope with code, message and hint', () => {
      const { body, status } = runFilter(
        new ApiError(
          ErrorCode.QUIZ_ALREADY_ATTEMPTED,
          409,
          'You have already taken this quiz.',
          { hint: 'RETRY' },
        ),
      );
      expect(status).toBe(409);
      expect(body).toMatchObject({
        statusCode: 409,
        code: 'QUIZ_ALREADY_ATTEMPTED',
        message: 'You have already taken this quiz.',
        hint: 'RETRY',
      });
    });

    it('defaults hint to null and keeps details', () => {
      const { body } = runFilter(
        new ApiError(ErrorCode.VALIDATION_FAILED, 400, 'Invalid input.', {
          details: [{ field: 'email', message: 'must be an email' }],
        }),
      );
      expect(body.hint).toBeNull();
      expect(body.details).toEqual([
        { field: 'email', message: 'must be an email' },
      ]);
    });
  });

  describe('legacy HttpExceptions (fallback path)', () => {
    it('maps a generic NotFound to NOT_FOUND with friendly copy', () => {
      const { body } = runFilter(new NotFoundException());
      expect(body).toMatchObject({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'This item could not be found. It may have been removed.',
        hint: null,
      });
    });

    it('passes custom messages through verbatim (Phase A)', () => {
      const { body } = runFilter(new NotFoundException('Quiz not found'));
      expect(body).toMatchObject({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'Quiz not found',
      });
    });

    it('replaces Nest route-not-found messages with friendly copy', () => {
      const { body } = runFilter(
        new NotFoundException('Cannot POST /quizzes/x/attempts'),
      );
      expect(body.message).toBe(
        'This item could not be found. It may have been removed.',
      );
    });

    it('maps generic Forbidden to friendly copy', () => {
      const { body } = runFilter(new ForbiddenException());
      expect(body.message).toBe("You don't have permission to do that.");
      expect(body.code).toBe('FORBIDDEN');
    });

    it('maps 401 to RE_LOGIN hint', () => {
      const { body } = runFilter(
        new (class extends HttpExceptionImpl {})('nope', 401),
      );
      expect(body.hint).toBe('RE_LOGIN');
      expect(body.code).toBe('UNAUTHORIZED');
    });
  });

  describe('nestjs-zod validation (array response)', () => {
    it('emits VALIDATION_FAILED with field-level details', () => {
      const { body, status } = runFilter(
        new BadRequestException([
          { path: ['email'], message: 'must be a valid email' },
          { path: ['name'], message: 'required' },
        ]),
      );
      expect(status).toBe(400);
      expect(body.code).toBe('VALIDATION_FAILED');
      expect(body.details).toEqual([
        { field: 'email', message: 'must be a valid email' },
        { field: 'name', message: 'required' },
      ]);
    });
  });

  describe('Prisma errors', () => {
    it('maps P2002 (unique) to 409 CONFLICT with friendly copy', () => {
      const { body, status } = runFilter(
        new Prisma.PrismaClientKnownRequestError('unique violation', {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: ['email'] },
        }),
      );
      expect(status).toBe(409);
      expect(body.code).toBe('CONFLICT');
      expect(body.message).toBe('This action conflicts with existing data.');
    });

    it('maps P2025 (not found) to 404 NOT_FOUND', () => {
      const { body, status } = runFilter(
        new Prisma.PrismaClientKnownRequestError('record not found', {
          code: 'P2025',
          clientVersion: 'test',
        }),
      );
      expect(status).toBe(404);
      expect(body.code).toBe('NOT_FOUND');
    });

    it('falls back to INTERNAL_ERROR for unknown Prisma codes', () => {
      const { body, status } = runFilter(
        new Prisma.PrismaClientKnownRequestError('weird', {
          code: 'P9999',
          clientVersion: 'test',
        }),
      );
      expect(status).toBe(500);
      expect(body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('unknown errors (500)', () => {
    it('returns INTERNAL_ERROR with friendly copy and RETRY hint', () => {
      const { body, status } = runFilter(new Error('boom'));
      expect(status).toBe(500);
      expect(body).toMatchObject({
        code: 'INTERNAL_ERROR',
        message:
          'Something went wrong on our side. Please try again in a moment.',
        hint: 'RETRY',
      });
    });
  });

  describe('environment awareness', () => {
    it('includes dev details in development', () => {
      process.env.NODE_ENV = 'development';
      const { body } = runFilter(new Error('boom'));
      expect(body.dev).toBeDefined();
      expect((body.dev as { error: string }).error).toContain('boom');
      expect((body.dev as { stack: string }).stack).toBeDefined();
    });

    it('omits dev details in production', () => {
      process.env.NODE_ENV = 'production';
      const { body } = runFilter(new Error('boom'));
      expect(body.dev).toBeUndefined();
      expect(body.message).toBe(
        'Something went wrong on our side. Please try again in a moment.',
      );
    });

    it('does not leak stack traces in production even for ApiError', () => {
      process.env.NODE_ENV = 'production';
      const { body } = runFilter(
        new ApiError(
          ErrorCode.TIER_REQUIRED,
          403,
          'This feature is not included in your current plan.',
        ),
      );
      expect(body.dev).toBeUndefined();
      expect(body.code).toBe('TIER_REQUIRED');
    });

    it('surfaces the cause chain in dev but never in production', () => {
      process.env.NODE_ENV = 'development';
      const cause = new Error('upstream boom');
      const devBody = runFilter(
        new ApiError(ErrorCode.AUTH_LOGIN_FAILED, 401, 'Could not sign in.', {
          cause,
        }),
      ).body;
      expect(devBody.dev).toBeDefined();
      expect(
        (devBody.dev as { cause: { error: string } }).cause.error,
      ).toContain('upstream boom');

      process.env.NODE_ENV = 'production';
      const prodBody = runFilter(
        new ApiError(ErrorCode.AUTH_LOGIN_FAILED, 401, 'Could not sign in.', {
          cause,
        }),
      ).body;
      expect(prodBody.dev).toBeUndefined();
      expect(prodBody.message).toBe('Could not sign in.');
    });
  });
});
