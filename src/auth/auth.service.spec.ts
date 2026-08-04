import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService } from './supabase.service';

describe('AuthService', () => {
  let service: AuthService;

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    organization: {
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

      await expect(service.getOauthAuthorizeUrl('microsoft')).rejects.toThrow(
        BadRequestException,
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

      await expect(service.getOauthAuthorizeUrl('google')).rejects.toThrow(
        'API_URL is not set',
      );
    });
  });

  describe('handleOauthCallback', () => {
    it('throws a 400 when the provider returns an error param', async () => {
      await expect(
        service.handleOauthCallback({ error: 'access_denied' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockSupabase.exchangeCodeForSession).not.toHaveBeenCalled();
    });

    it('throws a 400 when neither code nor error is present', async () => {
      await expect(service.handleOauthCallback({})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws a 401 when the code exchange fails', async () => {
      mockSupabase.exchangeCodeForSession.mockResolvedValue({
        data: { session: null, user: null },
        error: { message: 'Invalid authorization code' },
      });

      await expect(
        service.handleOauthCallback({ code: 'bad-code' }),
      ).rejects.toThrow(UnauthorizedException);
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

      expect(mockPrisma.organization.create).toHaveBeenCalledWith({
        data: { name: "John Doe's School" },
      });
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

      expect(mockPrisma.organization.create).toHaveBeenCalledWith({
        data: { name: "Jane Doe's School" },
      });
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

      await expect(service.login(credentials)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws a 401 when the password is wrong', async () => {
      mockAuthClient.auth.signInWithPassword.mockResolvedValue({
        data: { session: null },
        error: { message: 'Invalid login credentials' },
      });

      await expect(service.login(credentials)).rejects.toThrow(
        UnauthorizedException,
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

      await expect(service.refresh('bad-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
