import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ALLOW_GUARDIANLESS_KEY } from './allow-guardianless.decorator';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';
import { ErrorHint } from '../common/errors/hints';

/**
 * WP2 enforcement: while a student has no linked guardian (`guardianId`
 * null) every route is blocked EXCEPT those explicitly marked with
 * `@AllowGuardianless()` (read-only: grades, classes, dashboard, etc.).
 * Mirrors `SubscriptionGuard` shape and runs after RolesGuard so role
 * authorization is evaluated first.
 */
@Injectable()
export class GuardianRequirementGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const allowed = this.reflector.getAllAndOverride<boolean>(
      ALLOW_GUARDIANLESS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (allowed) return true;

    const request = context
      .switchToHttp()
      .getRequest<{ user?: { role: string; guardianId: string | null } }>();
    const user = request.user;
    if (!user) return true;

    if (user.role === 'STUDENT' && user.guardianId == null) {
      throw new ApiError(
        ErrorCode.GUARDIAN_REQUIRED,
        HttpStatus.FORBIDDEN,
        'A linked guardian is required to use this feature. Ask your school to link a parent, or share your school code so they can sign up.',
        { hint: ErrorHint.LINK_GUARDIAN },
      );
    }
    return true;
  }
}
