import { Injectable, HttpStatus } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService, OAuthProvider } from './supabase.service';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';
import { ErrorHint } from '../common/errors/hints';

const DEFAULT_OAUTH_PROVIDERS: OAuthProvider[] = ['google', 'microsoft'];
const DEFAULT_OAUTH_ROLE = 'ADMIN';
const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateJoinCode(): string {
  const bytes = randomBytes(8);
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += JOIN_CODE_ALPHABET[bytes[i] % JOIN_CODE_ALPHABET.length];
  }
  return code;
}

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
    organizationName?: string;
    joinCode?: string;
    role?: 'TEACHER' | 'STUDENT';
    gradeLevel?: number;
  }) {
    if (dto.joinCode) {
      return this.submitMembershipRequest({
        email: dto.email,
        password: dto.password,
        name: dto.name,
        joinCode: dto.joinCode,
        role: dto.role!,
        gradeLevel: dto.gradeLevel,
      });
    }

    const supabaseUserId = await this.createSupabaseUser(
      dto.email,
      dto.password,
    );

    const user = await this.prisma.$transaction(async (tx) => {
      const organization = await this.createOrganization(
        tx,
        dto.organizationName ?? `${dto.name}'s School`,
      );

      return tx.user.create({
        data: {
          authId: supabaseUserId,
          email: dto.email.toLowerCase(),
          name: dto.name,
          role: 'ADMIN',
          organizationId: organization.id,
        },
      });
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

  private async createSupabaseUser(
    email: string,
    password: string,
  ): Promise<string> {
    const { data, error } = await this.supabaseService
      .getClient()
      .auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

    if (data?.user?.id) return data.user.id;

    if (error?.message?.toLowerCase().includes('already registered')) {
      throw new ApiError(
        ErrorCode.AUTH_EMAIL_TAKEN,
        HttpStatus.CONFLICT,
        'An account with this email already exists.',
        { cause: error },
      );
    }
    throw new ApiError(
      ErrorCode.AUTH_SIGNUP_FAILED,
      HttpStatus.BAD_REQUEST,
      'We could not create your account. Please try again.',
      { hint: ErrorHint.RETRY, cause: error },
    );
  }

  private async createOrganization(tx: Prisma.TransactionClient, name: string) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await tx.organization.create({
          data: { name, joinCode: generateJoinCode() },
        });
      } catch (err) {
        if (
          !(err instanceof Prisma.PrismaClientKnownRequestError) ||
          err.code !== 'P2002'
        ) {
          throw err;
        }
      }
    }
    throw new Error('Could not allocate a unique join code');
  }

  private async submitMembershipRequest(dto: {
    email: string;
    password: string;
    name: string;
    joinCode: string;
    role: 'TEACHER' | 'STUDENT';
    gradeLevel?: number;
  }): Promise<{ status: 'PENDING'; message: string }> {
    const email = dto.email.toLowerCase();
    const organization = await this.prisma.organization.findUnique({
      where: { joinCode: dto.joinCode.trim().toUpperCase() },
    });
    if (!organization) {
      throw new ApiError(
        ErrorCode.JOIN_CODE_INVALID,
        HttpStatus.NOT_FOUND,
        'This join code is not valid. Please check it with your school administrator.',
      );
    }

    if (dto.role === 'STUDENT' && !dto.gradeLevel) {
      throw new ApiError(
        ErrorCode.VALIDATION_FAILED,
        HttpStatus.BAD_REQUEST,
        'A grade level is required for students.',
      );
    }

    const existingMember = await this.prisma.user.findFirst({
      where: { email, organizationId: organization.id },
    });
    if (existingMember) {
      throw new ApiError(
        ErrorCode.INVITE_EMAIL_TAKEN,
        HttpStatus.CONFLICT,
        'An account with this email already belongs to this organization.',
      );
    }

    const existingRequest = await this.prisma.membershipRequest.findFirst({
      where: { email, organizationId: organization.id, status: 'PENDING' },
    });
    if (existingRequest) {
      throw new ApiError(
        ErrorCode.REQUEST_ALREADY_EXISTS,
        HttpStatus.CONFLICT,
        'A request for this account is already awaiting review.',
      );
    }

    const { data, error } = await this.supabaseService
      .getClient()
      .auth.admin.createUser({
        email,
        password: dto.password,
        email_confirm: true,
      });

    let authId = data?.user?.id ?? null;
    if (
      !authId &&
      error?.message?.toLowerCase().includes('already registered')
    ) {
      const { data: signIn } = await this.supabaseService
        .getClient()
        .auth.signInWithPassword({ email, password: dto.password });
      authId = signIn?.user?.id ?? null;
      if (!authId) {
        throw new ApiError(
          ErrorCode.AUTH_EMAIL_TAKEN,
          HttpStatus.CONFLICT,
          'An account with this email already exists.',
          { cause: error },
        );
      }
    }

    if (!authId) {
      throw new ApiError(
        ErrorCode.AUTH_SIGNUP_FAILED,
        HttpStatus.BAD_REQUEST,
        'We could not create your account. Please try again.',
        { hint: ErrorHint.RETRY, cause: error },
      );
    }

    await this.prisma.membershipRequest.create({
      data: {
        organizationId: organization.id,
        email,
        name: dto.name,
        role: dto.role,
        authId,
        ...(dto.gradeLevel !== undefined ? { gradeLevel: dto.gradeLevel } : {}),
      },
    });

    return {
      status: 'PENDING',
      message:
        'Your request has been submitted. An administrator will review it shortly.',
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
      throw new ApiError(
        ErrorCode.AUTH_INVALID_CREDENTIALS,
        HttpStatus.UNAUTHORIZED,
        'The email or password is incorrect.',
        { hint: ErrorHint.RE_LOGIN, cause: error },
      );
    }

    const user =
      (await this.prisma.user.findUnique({
        where: { authId: session.user.id },
      })) ??
      (await this.prisma.user.findUnique({
        where: { email: session.user.email ?? '' },
      }));

    if (!user) {
      throw new ApiError(
        ErrorCode.AUTH_USER_NOT_FOUND,
        HttpStatus.UNAUTHORIZED,
        'This account could not be found. Please contact your administrator.',
        { hint: ErrorHint.RE_LOGIN },
      );
    }

    if (user.authId !== session.user.id) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { authId: session.user.id },
      });
    }

    return {
      accessToken: session.access_token,
      user: { ...user, authId: session.user.id },
    };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { grade: true },
    });

    if (!user) {
      throw new ApiError(
        ErrorCode.AUTH_USER_NOT_FOUND,
        HttpStatus.UNAUTHORIZED,
        'This account could not be found. Please contact your administrator.',
        { hint: ErrorHint.RE_LOGIN },
      );
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
      throw new ApiError(
        ErrorCode.AUTH_PROVIDER_DISABLED,
        HttpStatus.BAD_REQUEST,
        'This sign-in option is not enabled.',
      );
    }

    const apiUrl = process.env.API_URL ?? origin;
    if (!apiUrl) {
      throw new ApiError(
        ErrorCode.INTERNAL_ERROR,
        HttpStatus.INTERNAL_SERVER_ERROR,
        'Something went wrong on our side. Please try again in a moment.',
        { hint: ErrorHint.RETRY, cause: new Error('API_URL is not set') },
      );
    }

    const { data, error } = await this.supabaseService.signInWithOAuth(
      provider,
      `${apiUrl}/auth/oauth/callback`,
    );
    if (error || !data.url) {
      throw new ApiError(
        ErrorCode.AUTH_OAUTH_EXCHANGE_FAILED,
        HttpStatus.BAD_REQUEST,
        'We could not complete the sign-in. Please try again.',
        { hint: ErrorHint.RETRY, cause: error },
      );
    }
    return { url: data.url };
  }

  async handleOauthCallback(params: {
    code?: string;
    error?: string;
  }): Promise<{ accessToken: string; refreshToken: string }> {
    if (params.error) {
      throw new ApiError(
        ErrorCode.AUTH_OAUTH_REJECTED,
        HttpStatus.BAD_REQUEST,
        'The sign-in provider did not complete the sign-in. Please try again.',
      );
    }
    if (!params.code) {
      throw new ApiError(
        ErrorCode.AUTH_MISSING_CODE,
        HttpStatus.BAD_REQUEST,
        'The sign-in link was incomplete. Please try again.',
      );
    }

    const { data, error } = await this.supabaseService.exchangeCodeForSession(
      params.code,
    );
    if (error || !data.session) {
      throw new ApiError(
        ErrorCode.AUTH_OAUTH_EXCHANGE_FAILED,
        HttpStatus.UNAUTHORIZED,
        'We could not complete the sign-in. Please try again.',
        { hint: ErrorHint.RE_LOGIN, cause: error },
      );
    }

    const { session } = data;
    const email = session.user.email;
    if (!email) {
      throw new ApiError(
        ErrorCode.AUTH_OAUTH_EMAIL_MISSING,
        HttpStatus.BAD_REQUEST,
        'The sign-in provider did not return an email address.',
      );
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
      throw new ApiError(
        ErrorCode.AUTH_TOKEN_INVALID,
        HttpStatus.UNAUTHORIZED,
        'Your session is no longer valid. Please log in again.',
        { hint: ErrorHint.RE_LOGIN, cause: error },
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
      await this.prisma.$transaction(async (tx) => {
        const organization = await this.createOrganization(
          tx,
          `${name}'s School`,
        );
        await tx.user.create({
          data: {
            authId,
            email,
            name,
            role: DEFAULT_OAUTH_ROLE,
            organizationId: organization.id,
          },
        });
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
