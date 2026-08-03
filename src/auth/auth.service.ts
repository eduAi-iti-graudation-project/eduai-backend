import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService, OAuthProvider } from './supabase.service';

const DEFAULT_OAUTH_PROVIDERS: OAuthProvider[] = ['google', 'microsoft'];
const DEFAULT_OAUTH_ROLE = 'STUDENT';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly supabaseService: SupabaseService,
  ) {}

  async signup(dto: {
    email: string;
    password: string;
    name: string;
    role: 'TEACHER' | 'STUDENT' | 'GUARDIAN' | 'ADMIN';
    gradeLevel?: number;
  }) {
    let gradeId: string | undefined;
    if (dto.gradeLevel) {
      const grade = await this.prisma.grade.findUnique({
        where: { level: dto.gradeLevel },
      });
      if (!grade)
        throw new BadRequestException(`Grade ${dto.gradeLevel} not found`);
      gradeId = grade.id;
    }

    const { data, error } = await this.supabaseService
      .getClient()
      .auth.admin.createUser({
        email: dto.email,
        password: dto.password,
        email_confirm: true,
      });

    if (error || !data.user) {
      throw new UnauthorizedException(error?.message || 'Signup failed');
    }

    const user = await this.prisma.user.create({
      data: {
        authId: data.user.id,
        email: dto.email,
        name: dto.name,
        role: dto.role,
        gradeId,
      },
    });

    const {
      data: { session },
    } = await this.supabaseService
      .getClient()
      .auth.signInWithPassword({ email: dto.email, password: dto.password });

    return {
      accessToken: session?.access_token ?? '',
      user,
    };
  }

  async login(dto: { email: string; password: string }) {
    const {
      data: { session },
      error,
    } = await this.supabaseService
      .getClient()
      .auth.signInWithPassword({ email: dto.email, password: dto.password });

    if (error || !session) {
      throw new UnauthorizedException(error?.message || 'Login failed');
    }

    const user = await this.prisma.user.findUnique({
      where: { authId: session.user.id },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return {
      accessToken: session.access_token,
      user,
    };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return user;
  }

  async logout(authId: string): Promise<void> {
    await this.supabaseService.signOut(authId);
  }

  getProviders(): { providers: { provider: string; enabled: boolean }[] } {
    const configured =
      process.env.OAUTH_PROVIDERS ?? DEFAULT_OAUTH_PROVIDERS.join(',');
    const providers = configured
      .split(',')
      .map((provider) => provider.trim())
      .filter(Boolean);
    return {
      providers: providers.map((provider) => ({ provider, enabled: true })),
    };
  }

  async getOauthAuthorizeUrl(
    provider: OAuthProvider,
    origin?: string,
  ): Promise<{ url: string }> {
    const enabled = this.getProviders().providers.some(
      (entry) => entry.provider === provider,
    );
    if (!enabled) {
      throw new BadRequestException(`Provider '${provider}' is not enabled`);
    }

    const apiUrl = process.env.API_URL ?? origin;
    if (!apiUrl) {
      throw new InternalServerErrorException('API_URL is not set');
    }

    const { data, error } = await this.supabaseService.signInWithOAuth(
      provider,
      `${apiUrl}/auth/oauth/callback`,
    );
    if (error || !data.url) {
      throw new BadRequestException(
        error?.message || 'Failed to build OAuth authorization URL',
      );
    }
    return { url: data.url };
  }

  async handleOauthCallback(params: {
    code?: string;
    error?: string;
  }): Promise<{ accessToken: string; refreshToken: string }> {
    if (params.error) {
      throw new BadRequestException(
        'OAuth provider rejected the authorization request',
      );
    }
    if (!params.code) {
      throw new BadRequestException('Missing authorization code');
    }

    const { data, error } = await this.supabaseService.exchangeCodeForSession(
      params.code,
    );
    if (error || !data.session) {
      throw new UnauthorizedException(
        error?.message || 'Failed to exchange authorization code',
      );
    }

    const { session } = data;
    const email = session.user.email;
    if (!email) {
      throw new BadRequestException('OAuth provider did not return an email');
    }
    const metadata = (session.user.user_metadata ?? {}) as {
      full_name?: string;
      name?: string;
    };
    const name = metadata.full_name ?? metadata.name ?? email;

    await this.resolveOrCreateLocalUser({
      authId: session.user.id,
      email,
      name,
    });

    return {
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
    };
  }

  async refresh(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
  }> {
    const { data, error } =
      await this.supabaseService.refreshSession(refreshToken);
    if (error || !data.session) {
      throw new UnauthorizedException(
        error?.message || 'Invalid or expired refresh token',
      );
    }
    return {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
    };
  }

  private async resolveOrCreateLocalUser(input: {
    authId: string;
    email: string;
    name: string;
  }): Promise<void> {
    const { authId, email, name } = input;

    let user = await this.prisma.user.findUnique({ where: { authId } });
    if (user) return;

    user = await this.prisma.user.findUnique({ where: { email } });
    if (user) {
      if (user.authId !== authId) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { authId },
        });
      }
      return;
    }

    try {
      await this.prisma.user.create({
        data: { authId, email, name, role: DEFAULT_OAUTH_ROLE },
      });
    } catch (err) {
      if (
        !(err instanceof Prisma.PrismaClientKnownRequestError) ||
        err.code !== 'P2002'
      ) {
        throw err;
      }
      const existing =
        (await this.prisma.user.findUnique({ where: { authId } })) ??
        (await this.prisma.user.findUnique({ where: { email } }));
      if (!existing) {
        throw err;
      }
      if (existing.authId !== authId) {
        await this.prisma.user.update({
          where: { id: existing.id },
          data: { authId },
        });
      }
    }
  }
}
