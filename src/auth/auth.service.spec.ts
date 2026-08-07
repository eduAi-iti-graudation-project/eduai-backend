import { Prisma } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService } from './supabase.service';
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
    $transaction: jest.fn(),
  };

  const mockAuthClient = {
    auth: {
      signInWithPassword: jest.fn(),
      admin: {
        createUser: jest.fn(),
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
  };

  const originalProviders = process.env.OAUTH_PROVIDERS;
  const originalApiUrl = process.env.API_URL;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SupabaseService, useValue: mockSupabase },
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

    it('creates a new ADMIN user with a new organization', async () => {
      mockSupabase.exchangeCodeForSession.mockResolvedValue(oauthSession());
      mockPrisma.user.findUnique.mockResolvedValue(null);
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

      await service.handleOauthCallback({ code: 'code-123' });

      expect(mockPrisma.organization.create).toHaveBeenCalledTimes(1);
      const orgArgs = orgCreateArgs(mockPrisma.organization);
      expect(orgArgs.data.name).toBe("John Doe's School");
      expect(orgArgs.data.joinCode).toMatch(/^[A-Z0-9]{8}$/);
      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: {
          authId: 'supabase-auth-id-1',
          email: 'student@eduai.test',
          name: 'John Doe',
          role: 'ADMIN',
          organizationId: 'org-1',
        },
      });
    });

    it('falls back to user_metadata.name when full_name is absent', async () => {
      mockSupabase.exchangeCodeForSession.mockResolvedValue(
        oauthSession({ user_metadata: { name: 'Jane Doe' } }),
      );
      mockPrisma.user.findUnique.mockResolvedValue(null);
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

      await service.handleOauthCallback({ code: 'code-123' });

      expect(mockPrisma.organization.create).toHaveBeenCalledTimes(1);
      const orgArgs = orgCreateArgs(mockPrisma.organization);
      expect(orgArgs.data.name).toBe("Jane Doe's School");
      expect(orgArgs.data.joinCode).toMatch(/^[A-Z0-9]{8}$/);
      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: {
          authId: 'supabase-auth-id-1',
          email: 'student@eduai.test',
          name: 'Jane Doe',
          role: 'ADMIN',
          organizationId: 'org-1',
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
      mockPrisma.$transaction.mockRejectedValue(
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

  describe('refresh', () => {
    it('returns new tokens on success', async () => {
      mockSupabase.refreshSession.mockResolvedValue({
        data: {
          session: {
            access_token: 'new-access-token',
            refresh_token: 'new-refresh-token',
          },
          user: { id: 'supabase-auth-id-1' },
        },
        error: null,
      });

      const result = await service.refresh('old-refresh-token');

      expect(mockSupabase.refreshSession).toHaveBeenCalledWith(
        'old-refresh-token',
      );
      expect(result).toEqual({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      });
    });

    it('throws a 401 when the refresh token is invalid or expired', async () => {
      mockSupabase.refreshSession.mockResolvedValue({
        data: { session: null, user: null },
        error: { message: 'Invalid Refresh Token' },
      });

      await expectApiError(
        service.refresh('bad-token'),
        ErrorCode.AUTH_TOKEN_INVALID,
        401,
      );
    });
  });
});
