import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { Socket } from 'socket.io';
import type { User } from '@prisma/client';
import { SupabaseService } from '../auth/supabase.service';
import { PrismaService } from '../prisma/prisma.service';

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
      throw new UnauthorizedException('Missing authentication token');
    }

    const supabaseUser = await this.supabaseService.verifyToken(jwt);

    const localUser = await this.prisma.user.findUnique({
      where: { authId: supabaseUser.id },
    });

    if (!localUser) {
      throw new UnauthorizedException('User not found');
    }

    const userStore = client.data as { user?: User };
    userStore.user = localUser;
    return true;
  }
}
