import { Injectable, ExecutionContext, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { User } from '@prisma/client';
import { IS_PUBLIC_KEY } from './public.decorator';
import { SupabaseService } from './supabase.service';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';
import { ErrorHint } from '../common/errors/hints';

interface AuthenticatedRequest extends Request {
  user: User;
}

@Injectable()
export class AuthGuard {
  constructor(
    private readonly reflector: Reflector,
    private readonly supabaseService: SupabaseService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      throw new ApiError(
        ErrorCode.AUTH_MISSING_HEADER,
        HttpStatus.UNAUTHORIZED,
        'Please log in to continue.',
        { hint: ErrorHint.RE_LOGIN },
      );
    }

    const [scheme, token] = authHeader.split(' ');

    if (scheme !== 'Bearer' || !token) {
      throw new ApiError(
        ErrorCode.AUTH_TOKEN_INVALID,
        HttpStatus.UNAUTHORIZED,
        'Your session is no longer valid. Please log in again.',
        { hint: ErrorHint.RE_LOGIN },
      );
    }

    let supabaseUser: { id: string };
    try {
      supabaseUser = await this.supabaseService.verifyToken(token);
    } catch (cause) {
      throw new ApiError(
        ErrorCode.AUTH_TOKEN_EXPIRED,
        HttpStatus.UNAUTHORIZED,
        'Your session has expired. Please log in again.',
        { hint: ErrorHint.RE_LOGIN, cause },
      );
    }

    const localUser = await this.prisma.user.findUnique({
      where: { authId: supabaseUser.id },
      include: { organization: true },
    });

    if (!localUser) {
      throw new ApiError(
        ErrorCode.AUTH_USER_NOT_FOUND,
        HttpStatus.UNAUTHORIZED,
        'This account could not be found. Please contact your administrator.',
        { hint: ErrorHint.RE_LOGIN },
      );
    }

    request.user = localUser;
    return true;
  }
}
