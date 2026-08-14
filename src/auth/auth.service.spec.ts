import { Prisma } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService } from './supabase.service';
import { MailerService } from '../common/mailer/mailer.service';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';

async function expectApiError(
  promise: Promise<unknown>,
  code: string,
  status: number,
) {
  try {
    await promise;
    fail('expected an ApiError to be thrown');
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe(code);
    expect((err as ApiError).getStatus()).toBe(status);
  }
}

function callArgs<T>(mock: jest.Mock): T {
  const calls = mock.mock.calls as T[][];
  return calls[0][0];
}

function orgCreateArgs(mock: { create: jest.Mock }) {
  return callArgs<{ data: { name: string; joinCode: string } }>(mock.create);
}

describe('AuthService', () => {
  let service: AuthService;

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    organization: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    membershipRequest: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    guardianProfile: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    joinRequest: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockAuthClient = {
    auth: {
      signInWithPassword: jest.fn(),
      admin: {
        createUser: jest.fn(),
        updateUserById: jest.fn(),
        signOut: jest.fn(),
      },
    },
  };

  const mockSupabase = {
    getClient: jest.fn(() => mockAuthClient),
    signInWithOAuth: jest.fn(),
    exchangeCodeForSession: jest.fn(),
    refreshSession: jest.fn(),
    signOut: jest.fn(),
    resetPasswordForEmail: jest.fn(),
    getUserByToken: jest.fn(),
    updatePassword: jest.fn(),
  };

  const mockMailer = {
    send: jest.fn().mockResolvedValue(undefined),
  };

  const originalProviders = process.env.OAUTH_PROVIDERS;
  const originalApiUrl = process.env.API_URL;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SupabaseService, useValue: mockSupabase },
        { provide: MailerService, useValue: mockMailer },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (originalProviders === undefined) {
      delete process.env.OAUTH_PROVIDERS;
    } else {
      process.env.OAUTH_PROVIDERS = originalProviders;
    }
    if (originalApiUrl === undefined) {
      delete process.env.API_URL;
    } else {
      process.env.API_URL = originalApiUrl;
    }
  });

  function oauthSession(userOverrides: Record<string, unknown> = {}) {
    return {
      data: {
        session: {
          access_token: 'access-token-123',
          refresh_token: 'refresh-token-123',
          user: {
            id: 'supabase-auth-id-1',
            email: 'student@eduai.test',
            user_metadata: { full_name: 'John Doe' },
            ...userOverrides,
          },
        },
      },
      error: null,
    };
  }

  describe('getProviders', () => {
    it('returns the default allowlist when OAUTH_PROVIDERS is not set', () => {
      delete process.env.OAUTH_PROVIDERS;
      expect(service.getProviders()).toEqual({
        providers: [
          { provider: 'google', enabled: true },
          { provider: 'microsoft', enabled: true },
        ],
      });
    });

    it('returns the env-configured allowlist', () => {
      process.env.OAUTH_PROVIDERS = 'google';
      expect(service.getProviders()).toEqual({
        providers: [{ provider: 'google', enabled: true }],
      });
    });
  });

  describe('getOauthAuthorizeUrl', () => {
    it('returns the provider authorization URL for an enabled provider', async () => {
      process.env.API_URL = 'http://localhost:3000';
      mockSupabase.signInWithOAuth.mockResolvedValue({
        data: { provider: 'google', url: 'https://accounts.google.com/oauth' },
        error: null,
      });

      const result = await service.getOauthAuthorizeUrl('google');

      expect(mockSupabase.signInWithOAuth).toHaveBeenCalledWith(
        'google',
        'http://localhost:3000/auth/oauth/callback',
      );
      expect(result).toEqual({ url: 'https://accounts.google.com/oauth' });
    });

    it('throws a 400 when the provider is not in the allowlist', async () => {
      process.env.OAUTH_PROVIDERS = 'google';

      await expectApiError(
        service.getOauthAuthorizeUrl('microsoft'),
        ErrorCode.AUTH_PROVIDER_DISABLED,
        400,
      );
      expect(mockSupabase.signInWithOAuth).not.toHaveBeenCalled();
    });

    it('falls back to the request origin when API_URL is not set', async () => {
      delete process.env.API_URL;
      mockSupabase.signInWithOAuth.mockResolvedValue({
        data: { provider: 'google', url: 'https://accounts.google.com/oauth' },
        error: null,
      });

      await service.getOauthAuthorizeUrl('google', 'http://localhost:3000');

      expect(mockSupabase.signInWithOAuth).toHaveBeenCalledWith(
        'google',
        'http://localhost:3000/auth/oauth/callback',
      );
    });

    it('throws a 500 when neither API_URL nor an origin is available', async () => {
      delete process.env.API_URL;

      await expectApiError(
        service.getOauthAuthorizeUrl('google'),
        ErrorCode.INTERNAL_ERROR,
        500,
      );
    });
  });

  describe('handleOauthCallback', () => {
    it('throws a 400 when the provider returns an error param', async () => {
      await expectApiError(
        service.handleOauthCallback({ error: 'access_denied' }),
        ErrorCode.AUTH_OAUTH_REJECTED,
        400,
      );
      expect(mockSupabase.exchangeCodeForSession).not.toHaveBeenCalled();
    });

    it('throws a 400 when neither code nor error is present', async () => {
      await expectApiError(
        service.handleOauthCallback({}),
        ErrorCode.AUTH_MISSING_CODE,
        400,
      );
    });

    it('throws a 401 when the code exchange fails', async () => {
      mockSupabase.exchangeCodeForSession.mockResolvedValue({
        data: { session: null, user: null },
        error: { message: 'Invalid authorization code' },
      });

      await expectApiError(
        service.handleOauthCallback({ code: 'bad-code' }),
        ErrorCode.AUTH_OAUTH_EXCHANGE_FAILED,
        401,
      );
    });

    it('links an existing user by authId and returns the session tokens', async () => {
      mockSupabase.exchangeCodeForSession.mockResolvedValue(oauthSession());
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'local-1',
        authId: 'supabase-auth-id-1',
        email: 'student@eduai.test',
        role: 'TEACHER',
      });

      const result = await service.handleOauthCallback({ code: 'code-123' });

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { authId: 'supabase-auth-id-1' },
      });
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
      expect(result).toEqual({
        accessToken: 'access-token-123',
        refreshToken: 'refresh-token-123',
      });
    });

    it('links by email and preserves the existing role', async () => {
      mockSupabase.exchangeCodeForSession.mockResolvedValue(oauthSession());
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'local-1',
          authId: null,
          email: 'student@eduai.test',
          role: 'TEACHER',
        });
      mockPrisma.user.update.mockResolvedValue({ id: 'local-1' });

      await service.handleOauthCallback({ code: 'code-123' });

      expect(mockPrisma.user.findUnique).toHaveBeenNthCalledWith(2, {
        where: { email: 'student@eduai.test' },
      });
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'local-1' },
        data: { authId: 'supabase-auth-id-1' },
      });
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it('creates a new org-less ADMIN user (onboarded later via oauth/onboard)', async () => {
      mockSupabase.exchangeCodeForSession.mockResolvedValue(oauthSession());
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({ id: 'local-new' });

      await service.handleOauthCallback({ code: 'code-123' });

      expect(mockPrisma.organization.create).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: {
          authId: 'supabase-auth-id-1',
          email: 'student@eduai.test',
          name: 'John Doe',
          role: 'ADMIN',
        },
      });
    });

    it('falls back to user_metadata.name when full_name is absent', async () => {
      mockSupabase.exchangeCodeForSession.mockResolvedValue(
        oauthSession({ user_metadata: { name: 'Jane Doe' } }),
      );
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({ id: 'local-new' });

      await service.handleOauthCallback({ code: 'code-123' });

      expect(mockPrisma.organization.create).not.toHaveBeenCalled();
      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: {
          authId: 'supabase-auth-id-1',
          email: 'student@eduai.test',
          name: 'Jane Doe',
          role: 'ADMIN',
        },
      });
    });

    it('re-links the winner instead of failing on a concurrent unique-constraint create', async () => {
      mockSupabase.exchangeCodeForSession.mockResolvedValue(oauthSession());
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'local-other',
          authId: 'supabase-auth-id-1',
          email: 'student@eduai.test',
          role: 'STUDENT',
        });
      mockPrisma.user.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.handleOauthCallback({ code: 'code-123' }),
      ).resolves.toEqual({
        accessToken: 'access-token-123',
        refreshToken: 'refresh-token-123',
      });
    });
  });

  describe('signup', () => {
    const credentials = {
      email: 'new.teacher@eduai.test',
      password: 'password123',
      name: 'New Teacher',
    };

    beforeEach(() => {
      mockAuthClient.auth.admin.createUser.mockReset();
      mockPrisma.organization.findUnique.mockReset();
      mockPrisma.user.findFirst.mockReset();
      mockPrisma.membershipRequest.findFirst.mockReset();
      mockPrisma.membershipRequest.create.mockReset();
    });

    function supabaseUser(id = 'supabase-auth-new') {
      return { data: { user: { id } }, error: null };
    }

    it('creates a new organization and ADMIN on the create path', async () => {
      mockAuthClient.auth.admin.createUser.mockResolvedValue(supabaseUser());
      mockPrisma.organization.create.mockResolvedValue({ id: 'org-1' });
      mockPrisma.user.create.mockResolvedValue({ id: 'local-new' });
      mockPrisma.$transaction.mockImplementation(
        (
          cb: (tx: {
            organization: typeof mockPrisma.organization;
            user: typeof mockPrisma.user;
          }) => Promise<unknown>,
        ) =>
          cb({ organization: mockPrisma.organization, user: mockPrisma.user }),
      );
      mockAuthClient.auth.signInWithPassword.mockResolvedValue({
        data: { session: { access_token: 'access-token-new' } },
        error: null,
      });

      const result = await service.signup({
        ...credentials,
        organizationName: 'Sunrise Academy',
      });

      expect(mockPrisma.organization.create).toHaveBeenCalledTimes(1);
      const orgArgs = orgCreateArgs(mockPrisma.organization);
      expect(orgArgs.data.name).toBe('Sunrise Academy');
      expect(orgArgs.data.joinCode).toMatch(/^[A-Z0-9]{8}$/);
      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: {
          authId: 'supabase-auth-new',
          email: credentials.email,
          name: credentials.name,
          role: 'ADMIN',
          organizationId: 'org-1',
        },
      });
      expect(result).toMatchObject({
        accessToken: 'access-token-new',
        user: { id: 'local-new' },
      });
      expect(mockPrisma.membershipRequest.create).not.toHaveBeenCalled();
    });

    it('throws AUTH_EMAIL_TAKEN on the create path when the email is registered', async () => {
      mockAuthClient.auth.admin.createUser.mockResolvedValue({
        data: { user: null },
        error: { status: 409, message: 'already registered' },
      });

      await expectApiError(
        service.signup({
          ...credentials,
          organizationName: 'Sunrise Academy',
        }),
        ErrorCode.AUTH_EMAIL_TAKEN,
        409,
      );
    });

    it('creates a PENDING membership request on the join path without a session', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        joinCode: 'TEAM2026',
      });
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.membershipRequest.findFirst.mockResolvedValue(null);
      mockAuthClient.auth.admin.createUser.mockResolvedValue(supabaseUser());

      const result = await service.signup({
        ...credentials,
        joinCode: 'team2026',
        role: 'TEACHER',
      });

      expect(mockPrisma.organization.findUnique).toHaveBeenCalledWith({
        where: { joinCode: 'TEAM2026' },
      });
      expect(mockPrisma.membershipRequest.create).toHaveBeenCalledWith({
        data: {
          organizationId: 'org-1',
          email: credentials.email,
          name: credentials.name,
          role: 'TEACHER',
          authId: 'supabase-auth-new',
        },
      });
      const pending = result as { status: string; message: string };
      expect(pending.status).toBe('PENDING');
      expect(pending.message).toContain('request has been submitted');
      expect(mockAuthClient.auth.signInWithPassword).not.toHaveBeenCalled();
      expect(mockPrisma.organization.create).not.toHaveBeenCalled();
    });

    it('throws JOIN_CODE_INVALID when the join code does not match an org', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);

      await expectApiError(
        service.signup({
          ...credentials,
          joinCode: 'NOPE1234',
          role: 'STUDENT',
        }),
        ErrorCode.JOIN_CODE_INVALID,
        404,
      );
      expect(mockAuthClient.auth.admin.createUser).not.toHaveBeenCalled();
    });

    it('throws INVITE_EMAIL_TAKEN when the email is already a member', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        joinCode: 'TEAM2026',
      });
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'existing' });

      await expectApiError(
        service.signup({
          ...credentials,
          joinCode: 'TEAM2026',
          role: 'TEACHER',
        }),
        ErrorCode.INVITE_EMAIL_TAKEN,
        409,
      );
      expect(mockAuthClient.auth.admin.createUser).not.toHaveBeenCalled();
    });

    it('throws REQUEST_ALREADY_EXISTS when a pending request exists', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        joinCode: 'TEAM2026',
      });
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.membershipRequest.findFirst.mockResolvedValue({
        id: 'request-1',
      });

      await expectApiError(
        service.signup({
          ...credentials,
          joinCode: 'TEAM2026',
          role: 'STUDENT',
          gradeLevel: 10,
        }),
        ErrorCode.REQUEST_ALREADY_EXISTS,
        409,
      );
      expect(mockAuthClient.auth.admin.createUser).not.toHaveBeenCalled();
    });

    it('reuses an existing Supabase account on the join path via sign-in', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        joinCode: 'TEAM2026',
      });
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.membershipRequest.findFirst.mockResolvedValue(null);
      mockAuthClient.auth.admin.createUser.mockResolvedValue({
        data: { user: null },
        error: { status: 409, message: 'already registered' },
      });
      mockAuthClient.auth.signInWithPassword.mockResolvedValue({
        data: { user: { id: 'supabase-auth-existing' } },
        error: null,
      });

      const result = await service.signup({
        ...credentials,
        joinCode: 'TEAM2026',
        role: 'TEACHER',
      });

      expect(mockPrisma.membershipRequest.create).toHaveBeenCalledWith({
        data: {
          organizationId: 'org-1',
          email: credentials.email,
          name: credentials.name,
          role: 'TEACHER',
          authId: 'supabase-auth-existing',
        },
      });
      const pending = result as { status: string };
      expect(pending.status).toBe('PENDING');
    });

    it('persists the grade level on a STUDENT join request', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        joinCode: 'TEAM2026',
      });
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.membershipRequest.findFirst.mockResolvedValue(null);
      mockAuthClient.auth.admin.createUser.mockResolvedValue(supabaseUser());

      await service.signup({
        ...credentials,
        joinCode: 'TEAM2026',
        role: 'STUDENT',
        gradeLevel: 10,
      });

      expect(mockPrisma.membershipRequest.create).toHaveBeenCalledWith({
        data: {
          organizationId: 'org-1',
          email: credentials.email,
          name: credentials.name,
          role: 'STUDENT',
          authId: 'supabase-auth-new',
          gradeLevel: 10,
        },
      });
    });

    it('rejects a STUDENT join request without a grade level', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        joinCode: 'TEAM2026',
      });

      await expectApiError(
        service.signup({
          ...credentials,
          joinCode: 'TEAM2026',
          role: 'STUDENT',
        }),
        ErrorCode.VALIDATION_FAILED,
        400,
      );
      expect(mockAuthClient.auth.admin.createUser).not.toHaveBeenCalled();
      expect(mockPrisma.membershipRequest.create).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    const credentials = {
      email: 'student@eduai.test',
      password: 'password123',
    };

    function sessionFor(userId: string) {
      return {
        data: {
          session: {
            access_token: 'access-token-456',
            refresh_token: 'refresh-token-456',
            user: { id: userId, email: credentials.email },
          },
        },
        error: null,
      };
    }

    beforeEach(() => {
      mockAuthClient.auth.signInWithPassword.mockReset();
    });

    it('returns the user when authId matches', async () => {
      mockAuthClient.auth.signInWithPassword.mockResolvedValue(
        sessionFor('auth-1'),
      );
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'local-1',
        authId: 'auth-1',
        email: credentials.email,
      });

      const result = await service.login(credentials);

      expect(result.accessToken).toBe('access-token-456');
      expect(result.user.id).toBe('local-1');
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('links an invited user by email when authId does not match', async () => {
      mockAuthClient.auth.signInWithPassword.mockResolvedValue(
        sessionFor('auth-2'),
      );
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'invited-1',
          authId: null,
          email: credentials.email,
          role: 'TEACHER',
        });
      mockPrisma.user.update.mockResolvedValue({ id: 'invited-1' });

      const result = await service.login(credentials);

      expect(mockPrisma.user.findUnique).toHaveBeenNthCalledWith(2, {
        where: { email: credentials.email },
      });
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'invited-1' },
        data: { authId: 'auth-2' },
      });
      expect(result.user.authId).toBe('auth-2');
    });

    it('throws a 401 when no local user exists', async () => {
      mockAuthClient.auth.signInWithPassword.mockResolvedValue(
        sessionFor('auth-3'),
      );
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expectApiError(
        service.login(credentials),
        ErrorCode.AUTH_USER_NOT_FOUND,
        401,
      );
    });

    it('throws a 401 when the password is wrong', async () => {
      mockAuthClient.auth.signInWithPassword.mockResolvedValue({
        data: { session: null },
        error: { message: 'Invalid login credentials' },
      });

      await expectApiError(
        service.login(credentials),
        ErrorCode.AUTH_INVALID_CREDENTIALS,
        401,
      );
    });
  });

  describe('signupTeacher', () => {
    const validDto = {
      email: 'New.Teacher@eduai.test',
      password: 'Passw0rd!123',
      name: 'New Teacher',
      joinCode: 'TEAM2026',
      ssn: '123-45-6789',
      phone: '+15551234567',
      street: '1 Main St',
      city: 'Springfield',
      nationality: 'US',
      personalEmail: 'teacher.personal@example.com',
      dateOfBirth: new Date('1990-05-15T00:00:00.000Z'),
      emergencyContactName: 'Jane Doe',
      emergencyContactPhone: '+15559876543',
      emergencyContactRelationship: 'Spouse',
    };
    const validFile = {
      mimetype: 'image/jpeg',
      originalname: 'me.jpg',
      buffer: Buffer.from('fake-jpeg-bytes'),
    } as Express.Multer.File;

    let originalKey: string | undefined;
    let originalPhotoDir: string | undefined;

    beforeAll(() => {
      originalKey = process.env.TEACHER_SSN_ENCRYPTION_KEY;
      originalPhotoDir = process.env.PHOTO_UPLOAD_DIR;
      process.env.TEACHER_SSN_ENCRYPTION_KEY = 'test-ssn-key-123456';
      process.env.PHOTO_UPLOAD_DIR = '/tmp/eduai-teacher-photos-test';
    });

    afterAll(() => {
      if (originalKey === undefined)
        delete process.env.TEACHER_SSN_ENCRYPTION_KEY;
      else process.env.TEACHER_SSN_ENCRYPTION_KEY = originalKey;
      if (originalPhotoDir === undefined) delete process.env.PHOTO_UPLOAD_DIR;
      else process.env.PHOTO_UPLOAD_DIR = originalPhotoDir;
    });

    it('creates a pending teacher membership request with encrypted SSN and photo', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        joinCode: 'TEAM2026',
      });
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.membershipRequest.findFirst.mockResolvedValue(null);
      mockAuthClient.auth.admin.createUser.mockResolvedValue({
        data: { user: { id: 'auth-teacher-1' } },
        error: null,
      });

      const result = await service.signupTeacher(validDto, validFile);

      expect(result.status).toBe('PENDING');
      expect(result.message).toContain('submitted');
      const createCalls = mockPrisma.membershipRequest.create.mock.calls as [
        { data: Record<string, unknown> },
      ][];
      const createArgs = createCalls[0][0];
      expect(createArgs.data).toMatchObject({
        organizationId: 'org-1',
        email: 'new.teacher@eduai.test',
        role: 'TEACHER',
        authId: 'auth-teacher-1',
        ssnTail4: '6789',
        phone: '+15551234567',
        dateOfBirth: new Date('1990-05-15T00:00:00.000Z'),
      });
      expect(typeof createArgs.data.ssnEncrypted).toBe('string');
      expect(createArgs.data.ssnEncrypted).not.toContain('123-45-6789');
      expect(createArgs.data.photoUrl).toMatch(/\.jpg$/);
    });

    it('rejects when the photo is missing', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        id: 'org1',
        joinCode: 'TEAM2026',
      });
      await expectApiError(
        service.signupTeacher(validDto, undefined),
        ErrorCode.PHOTO_REQUIRED,
        400,
      );
    });
  });

  describe('forgotPassword / resetPassword (school accounts)', () => {
    const originalFrontendUrl = process.env.FRONTEND_URL;

    beforeEach(() => {
      process.env.FRONTEND_URL = 'https://app.example.edu';
    });

    afterEach(() => {
      if (originalFrontendUrl === undefined) {
        delete process.env.FRONTEND_URL;
      } else {
        process.env.FRONTEND_URL = originalFrontendUrl;
      }
    });

    it('routes a student real email to a self-issued reset link', async () => {
      mockPrisma.guardianProfile.findFirst.mockResolvedValue(null);
      mockPrisma.joinRequest.findFirst.mockResolvedValue({ userId: 'u-1' });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-1',
        name: 'Jane Doe',
        email: 'jane.doe@eduai.org',
      });
      mockPrisma.user.update.mockResolvedValue({});

      const result = await service.forgotPassword({
        email: 'jane@example.com',
        origin: 'http://api.local',
      });

      expect(result.message).toContain('If an account exists');
      const updateCalls = mockPrisma.user.update.mock.calls as [
        { where: { id: string }; data: Record<string, unknown> },
      ][];
      expect(updateCalls[0][0].where.id).toBe('u-1');
      expect(updateCalls[0][0].data.resetToken).toBeTruthy();
      expect(updateCalls[0][0].data.resetTokenExpiresAt).toBeInstanceOf(Date);
      const sendCalls = mockMailer.send.mock.calls as [
        { to: string; html: string },
      ][];
      expect(sendCalls[0][0].to).toBe('jane@example.com');
      expect(sendCalls[0][0].html).toContain('forgot-password?resetToken=');
      expect(mockSupabase.resetPasswordForEmail).not.toHaveBeenCalled();
    });

    it('routes a student school login back to its real inbox', async () => {
      mockPrisma.guardianProfile.findFirst.mockResolvedValue(null);
      mockPrisma.joinRequest.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ email: 'jane@example.com' });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-1',
        name: 'Jane Doe',
        role: 'STUDENT',
      });
      mockPrisma.user.update.mockResolvedValue({});

      await service.forgotPassword({
        email: 'jane.doe@eduai.org',
        origin: 'http://api.local',
      });

      const sendCalls = mockMailer.send.mock.calls as [
        { to: string; html: string },
      ][];
      expect(sendCalls[0][0].to).toBe('jane@example.com');
    });

    it('routes a guardian personal email to a self-issued reset link', async () => {
      mockPrisma.guardianProfile.findFirst.mockResolvedValue({
        guardianId: 'g-1',
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'g-1',
        name: 'Mom',
      });
      mockPrisma.user.update.mockResolvedValue({});

      await service.forgotPassword({
        email: 'mom@example.com',
        origin: 'http://api.local',
      });

      const sendCalls = mockMailer.send.mock.calls as [
        { to: string; html: string },
      ][];
      expect(sendCalls[0][0].to).toBe('mom@example.com');
    });

    it('falls back to Supabase for accounts without a stored real inbox', async () => {
      mockPrisma.guardianProfile.findFirst.mockResolvedValue(null);
      mockPrisma.joinRequest.findFirst.mockResolvedValue(null);
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockSupabase.resetPasswordForEmail.mockResolvedValue(undefined);

      await service.forgotPassword({
        email: 'teacher@realschool.com',
        origin: 'http://api.local',
      });

      expect(mockSupabase.resetPasswordForEmail).toHaveBeenCalledWith(
        'teacher@realschool.com',
        'https://app.example.edu/forgot-password',
      );
      expect(mockMailer.send).not.toHaveBeenCalled();
    });

    it('resets a school-account password with a self-issued token', async () => {
      const storedUser = {
        id: 'u-1',
        authId: 'auth-1',
        email: 'jane.doe@eduai.org',
        name: 'Jane Doe',
        resetToken: 'reset-tok',
        resetTokenExpiresAt: new Date(Date.now() + 60_000),
      };
      mockPrisma.user.findUnique.mockResolvedValue(storedUser);
      mockAuthClient.auth.admin.updateUserById.mockResolvedValue({
        data: {},
        error: null,
      });
      mockPrisma.user.update.mockResolvedValue(storedUser);
      mockAuthClient.auth.signInWithPassword.mockResolvedValue({
        data: { session: { access_token: 'access-1', refresh_token: 'r' } },
        error: null,
      });

      const result = await service.resetPassword({
        token: 'reset-tok',
        password: 'Newpass123',
        origin: 'http://api.local',
      });

      expect(result.accessToken).toBe('access-1');
      const updateCalls = mockPrisma.user.update.mock.calls as [
        { where: { id: string }; data: Record<string, unknown> },
      ][];
      expect(updateCalls[0][0].data.resetToken).toBeNull();
      expect(updateCalls[0][0].data.resetTokenExpiresAt).toBeNull();
      expect(updateCalls[0][0].data.credentialEncrypted).toBeTruthy();
      const passwordCalls = mockSupabase.updatePassword.mock.calls as [
        string,
        string,
      ][];
      expect(passwordCalls[0][0]).toBe('auth-1');
      expect(passwordCalls[0][1]).toBe('Newpass123');
      expect(mockSupabase.getUserByToken).not.toHaveBeenCalled();
    });

    it('rejects an expired self-issued reset token', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-1',
        authId: 'auth-1',
        email: 'jane.doe@eduai.org',
        resetToken: 'reset-tok',
        resetTokenExpiresAt: new Date(Date.now() - 60_000),
      });

      await expectApiError(
        service.resetPassword({
          token: 'reset-tok',
          password: 'Newpass123',
          origin: 'http://api.local',
        }),
        ErrorCode.RESET_TOKEN_EXPIRED,
        410,
      );
    });
  });
});
