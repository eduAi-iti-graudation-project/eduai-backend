import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpStatus,
} from '@nestjs/common';
import type { Socket } from 'socket.io';
import type { User } from '@prisma/client';
import { SupabaseService } from '../auth/supabase.service';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';
import { ErrorHint } from '../common/errors/hints';

type AuthSocket = Socket & { data: { user?: User } };

@Injectable()
export class WsAuthGuard implements CanActivate {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const client = context.switchToWs().getClient<AuthSocket>();
    const auth = (client.handshake.auth ?? {}) as Record<string, unknown>;
    const authToken = auth['token'];
    const headerAuth = client.handshake.headers?.authorization;
    const tokenFromAuth = typeof authToken === 'string' ? authToken : undefined;

    const jwt = tokenFromAuth
      ? tokenFromAuth
      : typeof headerAuth === 'string' && headerAuth.startsWith('Bearer ')
        ? headerAuth.split(' ')[1]
        : undefined;

    if (!jwt) {
      throw new ApiError(
        ErrorCode.AUTH_MISSING_HEADER,
        HttpStatus.UNAUTHORIZED,
        'Please log in to continue.',
        { hint: ErrorHint.RE_LOGIN },
      );
    }

    const supabaseUser = await this.supabaseService.verifyToken(jwt);

    const localUser = await this.prisma.user.findUnique({
      where: { authId: supabaseUser.id },
    });

    if (!localUser) {
      throw new ApiError(
        ErrorCode.AUTH_USER_NOT_FOUND,
        HttpStatus.UNAUTHORIZED,
        'This account could not be found. Please contact your administrator.',
        { hint: ErrorHint.RE_LOGIN },
      );
    }

    const userStore = client.data as { user?: User };
    userStore.user = localUser;
    return true;
  }
}
