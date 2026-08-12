import { Injectable, HttpStatus } from '@nestjs/common';
import { randomBytes } from 'crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService, OAuthProvider } from './supabase.service';
import { MailerService } from '../common/mailer/mailer.service';
import {
  decryptCredential,
  encryptCredential,
} from '../common/crypto/credentials';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';
import { ErrorHint } from '../common/errors/hints';
import { encryptSsn, ssnTail4 } from '../common/crypto/ssn';

const DEFAULT_OAUTH_PROVIDERS: OAuthProvider[] = ['google', 'microsoft'];
const DEFAULT_OAUTH_ROLE = 'ADMIN';
const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

function generateJoinCode(): string {
  const bytes = randomBytes(8);
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += JOIN_CODE_ALPHABET[bytes[i] % JOIN_CODE_ALPHABET.length];
  }
  return code;
}

function slugifyOrgName(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'school';
}

/** Default school login domain derived from the organization name. */
export function emailDomainFor(name: string): string {
  return `${slugifyOrgName(name)}.org`;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly supabaseService: SupabaseService,
    private readonly mailer: MailerService,
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

  private savePhoto(photo: Express.Multer.File | undefined): string {
    if (!photo) {
      throw new ApiError(
        ErrorCode.PHOTO_REQUIRED,
        HttpStatus.BAD_REQUEST,
        'A personal photo is required to join as a teacher.',
      );
    }
    const mime = photo.mimetype ?? '';
    if (!mime.startsWith('image/')) {
      throw new ApiError(
        ErrorCode.PHOTO_INVALID,
        HttpStatus.BAD_REQUEST,
        'The photo must be a JPEG or PNG image.',
      );
    }
    const ext =
      mime === 'image/png'
        ? 'png'
        : mime === 'image/jpeg' || mime === 'image/jpg'
          ? 'jpg'
          : null;
    if (!ext) {
      throw new ApiError(
        ErrorCode.PHOTO_INVALID,
        HttpStatus.BAD_REQUEST,
        'The photo must be a JPEG or PNG image.',
      );
    }
    const dir = path.resolve(
      process.cwd(),
      process.env.PHOTO_UPLOAD_DIR ?? 'uploads/photos',
    );
    fs.mkdirSync(dir, { recursive: true });
    const fileName = `${Date.now()}-${randomBytes(6).toString('hex')}.${ext}`;
    const fileUrl = path.join(dir, fileName);
    try {
      fs.writeFileSync(fileUrl, photo.buffer);
    } catch {
      throw new ApiError(
        ErrorCode.PHOTO_UPLOAD_FAILED,
        HttpStatus.INTERNAL_SERVER_ERROR,
        'Could not save the photo. Please try again.',
      );
    }
    return fileUrl;
  }

  private async createAuthIdentity(
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

    let authId = data?.user?.id ?? null;
    if (
      !authId &&
      error?.message?.toLowerCase().includes('already registered')
    ) {
      const { data: signIn } = await this.supabaseService
        .getClient()
        .auth.signInWithPassword({ email, password });
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
    return authId;
  }

  async signupTeacher(
    dto: {
      email: string;
      password: string;
      name: string;
      joinCode: string;
      ssn: string;
      phone: string;
      street: string;
      city: string;
      nationality?: string;
      personalEmail?: string;
      dateOfBirth: Date;
      emergencyContactName?: string;
      emergencyContactPhone?: string;
      emergencyContactRelationship?: string;
    },
    photo: Express.Multer.File | undefined,
  ): Promise<{ status: 'PENDING'; message: string }> {
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

    const authId = await this.createAuthIdentity(email, dto.password);
    const photoUrl = this.savePhoto(photo);

    const ssnEncrypted = encryptSsn(dto.ssn);
    const ssnTail = ssnTail4(dto.ssn);

    try {
      await this.prisma.membershipRequest.create({
        data: {
          organizationId: organization.id,
          email,
          name: dto.name,
          role: 'TEACHER',
          authId,
          photoUrl,
          ssnEncrypted,
          ssnTail4: ssnTail,
          phone: dto.phone,
          street: dto.street,
          city: dto.city,
          nationality: dto.nationality ?? null,
          personalEmail: dto.personalEmail?.trim() ? dto.personalEmail : null,
          dateOfBirth: dto.dateOfBirth,
          emergencyContactName: dto.emergencyContactName ?? null,
          emergencyContactPhone: dto.emergencyContactPhone ?? null,
          emergencyContactRelationship:
            dto.emergencyContactRelationship ?? null,
        },
      });
    } catch (error) {
      try {
        fs.unlinkSync(photoUrl);
      } catch {
        /* best-effort cleanup */
      }
      throw error;
    }

    return {
      status: 'PENDING',
      message:
        'Your request has been submitted. An administrator will review it shortly.',
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
          data: {
            name,
            joinCode: generateJoinCode(),
            emailDomain: emailDomainFor(name),
          },
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

    const isStudent = user.role === 'STUDENT';
    return {
      ...user,
      // Guardian linkage drives the enforcement block-list (WP2): while a
      // student has no linked guardian, write-style features stay blocked.
      guardianLinked:
        user.role === 'GUARDIAN'
          ? true
          : isStudent
            ? user.guardianId != null
            : true,
      invitePending: isStudent && user.guardianId == null,
    };
  }

  /**
   * Verify-before-reveal: the invite link carries only this token. Validating
   * it marks the user verified and returns the school login credentials once
   * — the response is the sole delivery channel (school mailboxes don't
   * exist, so they can never arrive by email).
   */
  async verifyEmail(token: string): Promise<{
    email: string;
    password: string;
    schoolCode: string | null;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { verifyToken: token },
    });
    if (!user) {
      throw new ApiError(
        ErrorCode.VERIFY_TOKEN_INVALID,
        HttpStatus.GONE,
        'This verification link is no longer valid.',
      );
    }
    if (
      user.verifyTokenExpiresAt &&
      user.verifyTokenExpiresAt.getTime() < Date.now()
    ) {
      throw new ApiError(
        ErrorCode.VERIFY_TOKEN_EXPIRED,
        HttpStatus.GONE,
        'This verification link has expired. Your school can resend your invite.',
        { hint: ErrorHint.CONTACT_SUPPORT },
      );
    }
    if (!user.credentialEncrypted) {
      throw new ApiError(
        ErrorCode.VERIFY_TOKEN_INVALID,
        HttpStatus.GONE,
        'This verification link is no longer valid.',
      );
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerifiedAt: new Date(),
        verifyToken: null,
        verifyTokenExpiresAt: null,
      },
    });

    const organization = await this.prisma.organization.findUnique({
      where: { id: user.organizationId },
      select: { joinCode: true },
    });

    return {
      email: user.email,
      password: decryptCredential(user.credentialEncrypted),
      schoolCode: organization?.joinCode ?? null,
    };
  }

  /**
   * "Resend my credentials" — recovery path for users whose school login was
   * generated for them. Only serves users who already verified (their real
   * inbox works); always answers the same way to avoid leaking whether an
   * address is known.
   */
  async resendCredentials(personalEmail: string): Promise<{ message: string }> {
    const email = personalEmail.trim().toLowerCase();

    const guardianProfile = await this.prisma.guardianProfile.findFirst({
      where: { personalEmail: email },
      select: { guardianId: true },
    });
    const rosterRow = guardianProfile
      ? null
      : await this.prisma.joinRequest.findFirst({
          where: {
            email,
            source: 'ROSTER',
            status: 'APPROVED',
            userId: { not: null },
          },
          select: { userId: true },
        });

    const userId = guardianProfile?.guardianId ?? rosterRow?.userId ?? null;
    if (!userId) {
      return {
        message:
          'If an account matches that email, your login details have been sent to it.',
      };
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (
      !user ||
      !user.emailVerifiedAt ||
      !user.credentialEncrypted ||
      !user.email
    ) {
      return {
        message:
          'If an account matches that email, your login details have been sent to it.',
      };
    }

    const organization = await this.prisma.organization.findUnique({
      where: { id: user.organizationId },
      select: { joinCode: true },
    });
    const password = decryptCredential(user.credentialEncrypted);

    await this.mailer.send({
      to: email,
      subject: 'Your EduAI login details',
      html: `<p>Hi ${user.name},</p><p>Here are your EduAI login details again:</p><p><b>Email:</b> ${user.email}<br/><b>Password:</b> ${password}</p><p>School code: <b>${organization?.joinCode ?? '—'}</b></p><p>If you didn't ask for this, you can ignore this email.</p>`,
    });

    return {
      message:
        'If an account matches that email, your login details have been sent to it.',
    };
  }

  /**
   * OAuth onboarding for org-less admins (WP3): either join an existing
   * school by join code or create a new one from the provided name.
   */
  async oauthOnboard(
    userId: string,
    dto: { organizationName?: string; joinCode?: string },
  ): Promise<{
    id: string;
    name: string;
    joinCode: string;
    emailDomain?: string | null;
  }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new ApiError(
        ErrorCode.AUTH_USER_NOT_FOUND,
        HttpStatus.UNAUTHORIZED,
        'This account could not be found. Please contact your administrator.',
        { hint: ErrorHint.RE_LOGIN },
      );
    }
    if (user.organizationId) {
      throw new ApiError(
        ErrorCode.ALREADY_ONBOARDED,
        HttpStatus.CONFLICT,
        'This account is already linked to an organization.',
      );
    }

    const joinCode = dto.joinCode?.trim().toUpperCase();
    if (joinCode) {
      const organization = await this.prisma.organization.findUnique({
        where: { joinCode },
      });
      if (!organization) {
        throw new ApiError(
          ErrorCode.JOIN_CODE_INVALID,
          HttpStatus.NOT_FOUND,
          'This join code is not valid. Please check it with your school administrator.',
        );
      }
      await this.prisma.user.update({
        where: { id: userId },
        data: { organizationId: organization.id },
      });
      return {
        id: organization.id,
        name: organization.name,
        joinCode: organization.joinCode,
        emailDomain: organization.emailDomain,
      };
    }

    const organizationName = dto.organizationName?.trim();
    if (!organizationName) {
      throw new ApiError(
        ErrorCode.ONBOARDING_INPUT_REQUIRED,
        HttpStatus.BAD_REQUEST,
        'Provide an organization name or a join code to finish setting up your account.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const organization = await this.createOrganization(tx, organizationName);
      await tx.user.update({
        where: { id: userId },
        data: { organizationId: organization.id },
      });
      return {
        id: organization.id,
        name: organization.name,
        joinCode: organization.joinCode,
        emailDomain: organization.emailDomain,
      };
    });
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

  async changePassword(input: {
    email: string;
    authId: string;
    currentPassword: string;
    newPassword: string;
  }): Promise<{ message: string }> {
    const { error } = await this.supabaseService
      .getClient()
      .auth.signInWithPassword({
        email: input.email,
        password: input.currentPassword,
      });
    if (error) {
      throw new ApiError(
        ErrorCode.AUTH_INVALID_CREDENTIALS,
        HttpStatus.UNAUTHORIZED,
        'Your current password is incorrect.',
        { hint: ErrorHint.RE_LOGIN, cause: error },
      );
    }
    await this.supabaseService.updatePassword(input.authId, input.newPassword);
    return { message: 'Your password has been updated.' };
  }

  async forgotPassword(dto: { email: string; origin: string }): Promise<{
    message: string;
  }> {
    const email = dto.email.trim().toLowerCase();

    // School accounts have a fake login mailbox: route the reset through the
    // verified real inbox with a self-issued token instead of a Supabase
    // magic link that could never arrive.
    const realInbox = await this.resolveRealInbox(email);
    if (realInbox) {
      const frontendUrl = process.env.FRONTEND_URL;
      if (!frontendUrl) {
        throw new ApiError(
          ErrorCode.INTERNAL_ERROR,
          HttpStatus.INTERNAL_SERVER_ERROR,
          'Something went wrong on our side. Please try again in a moment.',
          {
            hint: ErrorHint.RETRY,
            cause: new Error('FRONTEND_URL is not set'),
          },
        );
      }
      const token = randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
      await this.prisma.user.update({
        where: { id: realInbox.userId },
        data: { resetToken: token, resetTokenExpiresAt: expiresAt },
      });
      const resetLink = `${frontendUrl}/forgot-password?resetToken=${encodeURIComponent(token)}`;
      await this.mailer.send({
        to: realInbox.email,
        subject: 'Reset your EduAI password',
        html: `<p>Hi ${realInbox.userName},</p><p>We received a request to reset your EduAI password. This link expires in 30 minutes:</p><p><a href="${resetLink}">Reset my password</a></p><p>If you didn't ask for this, you can ignore this email.</p>`,
      });
    } else {
      const apiUrl = process.env.API_URL ?? dto.origin;
      const frontendUrl = process.env.FRONTEND_URL;
      const redirectTo = frontendUrl
        ? `${frontendUrl}/forgot-password`
        : `${apiUrl}/forgot-password`;
      await this.supabaseService.resetPasswordForEmail(dto.email, redirectTo);
    }
    // Always respond the same way to avoid leaking whether an account exists.
    return {
      message:
        'If an account exists for that email, a password reset link has been sent.',
    };
  }

  /**
   * Resolve the deliverable inbox for a school account: an entered personal
   * email maps straight to it; an entered school login maps back to the real
   * inbox recorded at provisioning (student: join request row; guardian:
   * profile).
   */
  private async resolveRealInbox(email: string): Promise<{
    userId: string;
    email: string;
    userName: string;
  } | null> {
    const guardianProfile = await this.prisma.guardianProfile.findFirst({
      where: { personalEmail: email },
      select: { guardianId: true },
    });
    if (guardianProfile) {
      const guardian = await this.prisma.user.findUnique({
        where: { id: guardianProfile.guardianId },
        select: { id: true, name: true },
      });
      if (guardian) {
        return { userId: guardian.id, email, userName: guardian.name };
      }
    }

    const rosterUser = await this.prisma.joinRequest.findFirst({
      where: {
        email,
        source: { in: ['ROSTER', 'SELF'] },
        status: 'APPROVED',
        userId: { not: null },
      },
      select: { userId: true },
    });
    if (rosterUser?.userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: rosterUser.userId },
        select: { id: true, name: true, email: true },
      });
      if (user && user.email.toLowerCase() !== email) {
        return { userId: user.id, email, userName: user.name };
      }
    }

    // The entered address may itself be the school login — map it back to
    // the real inbox recorded at provisioning.
    const schoolAccount = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, name: true, role: true },
    });
    if (!schoolAccount) return null;
    if (schoolAccount.role === 'GUARDIAN') {
      const profile = await this.prisma.guardianProfile.findUnique({
        where: { guardianId: schoolAccount.id },
        select: { personalEmail: true },
      });
      if (profile?.personalEmail) {
        return {
          userId: schoolAccount.id,
          email: profile.personalEmail,
          userName: schoolAccount.name,
        };
      }
    }
    if (schoolAccount.role === 'STUDENT') {
      const row = await this.prisma.joinRequest.findFirst({
        where: { userId: schoolAccount.id, source: 'ROSTER' },
        select: { email: true },
      });
      if (row?.email) {
        return {
          userId: schoolAccount.id,
          email: row.email,
          userName: schoolAccount.name,
        };
      }
    }
    return null;
  }

  async resetPassword(dto: {
    token: string;
    password: string;
    origin: string;
  }): Promise<{ accessToken: string; user: unknown }> {
    // School-account self-service reset: a self-issued token that arrived in
    // the verified real inbox.
    const localReset = await this.prisma.user.findUnique({
      where: { resetToken: dto.token },
    });
    if (localReset) {
      if (
        !localReset.resetTokenExpiresAt ||
        localReset.resetTokenExpiresAt.getTime() < Date.now()
      ) {
        throw new ApiError(
          ErrorCode.RESET_TOKEN_EXPIRED,
          HttpStatus.GONE,
          'This reset link has expired. Request a new one.',
        );
      }
      if (!localReset.authId) {
        throw new ApiError(
          ErrorCode.AUTH_USER_NOT_FOUND,
          HttpStatus.BAD_REQUEST,
          'This account has no auth identity to reset.',
        );
      }
      await this.supabaseService.updatePassword(
        localReset.authId,
        dto.password,
      );
      await this.prisma.user.update({
        where: { id: localReset.id },
        data: {
          resetToken: null,
          resetTokenExpiresAt: null,
          credentialEncrypted: encryptCredential(dto.password),
        },
      });
      const {
        data: { session },
        error,
      } = await this.supabaseService.getClient().auth.signInWithPassword({
        email: localReset.email,
        password: dto.password,
      });
      if (error || !session) {
        throw new ApiError(
          ErrorCode.AUTH_RESET_FAILED,
          HttpStatus.BAD_REQUEST,
          'We could not sign you in after resetting your password. Please try again.',
          { hint: ErrorHint.RETRY, cause: error },
        );
      }
      return { accessToken: session.access_token, user: localReset };
    }

    // Real-email accounts: the Supabase recovery-link token flow.
    const { id: authId, email } = await this.supabaseService.getUserByToken(
      dto.token,
    );
    await this.supabaseService.updatePassword(authId, dto.password);

    const user =
      (await this.prisma.user.findUnique({ where: { authId } })) ??
      (await this.prisma.user.findUnique({ where: { email } }));
    if (!user) {
      throw new ApiError(
        ErrorCode.AUTH_USER_NOT_FOUND,
        HttpStatus.UNAUTHORIZED,
        'This account could not be found. Please contact your administrator.',
        { hint: ErrorHint.RE_LOGIN },
      );
    }

    const {
      data: { session },
      error,
    } = await this.supabaseService
      .getClient()
      .auth.signInWithPassword({ email: user.email, password: dto.password });
    if (error || !session) {
      throw new ApiError(
        ErrorCode.AUTH_RESET_FAILED,
        HttpStatus.BAD_REQUEST,
        'We could not sign you in after resetting your password. Please try again.',
        { hint: ErrorHint.RETRY, cause: error },
      );
    }
    return { accessToken: session.access_token, user };
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
