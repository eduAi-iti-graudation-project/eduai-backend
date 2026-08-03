import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let app: INestApplication<App>;

  const mockAuthService = {
    getProviders: jest.fn(),
    getOauthAuthorizeUrl: jest.fn(),
    handleOauthCallback: jest.fn(),
    refresh: jest.fn(),
  };

  const originalFrontendUrl = process.env.FRONTEND_URL;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await app.close();
    if (originalFrontendUrl === undefined) {
      delete process.env.FRONTEND_URL;
    } else {
      process.env.FRONTEND_URL = originalFrontendUrl;
    }
  });

  describe('GET /auth/providers', () => {
    it('returns the env-configured allowlist', async () => {
      const expected = {
        providers: [{ provider: 'google', enabled: true }],
      };
      mockAuthService.getProviders.mockReturnValue(expected);

      const res = await request(app.getHttpServer())
        .get('/auth/providers')
        .expect(200);

      expect(res.body).toEqual(expected);
      expect(mockAuthService.getProviders).toHaveBeenCalled();
    });
  });

  describe('POST /auth/oauth/:provider/authorize', () => {
    it('returns the provider authorization URL for a valid provider', async () => {
      mockAuthService.getOauthAuthorizeUrl.mockResolvedValue({
        url: 'https://accounts.google.com/oauth',
      });

      const res = await request(app.getHttpServer())
        .post('/auth/oauth/google/authorize')
        .expect(201);

      expect(mockAuthService.getOauthAuthorizeUrl).toHaveBeenCalledWith(
        'google',
        expect.stringMatching(/^http:\/\/.+/),
      );
      expect(res.body).toEqual({ url: 'https://accounts.google.com/oauth' });
    });

    it('returns a 400 for a provider not in the allowlist', async () => {
      mockAuthService.getOauthAuthorizeUrl.mockRejectedValue(
        new BadRequestException("Provider 'facebook' is not enabled"),
      );

      await request(app.getHttpServer())
        .post('/auth/oauth/facebook/authorize')
        .expect(400);
    });
  });

  describe('GET /auth/oauth/callback', () => {
    it('redirects to the frontend with the session in the URL fragment', async () => {
      process.env.FRONTEND_URL = 'http://localhost:5173';
      mockAuthService.handleOauthCallback.mockResolvedValue({
        accessToken: 'access-token-123',
        refreshToken: 'refresh-token-123',
      });

      await request(app.getHttpServer())
        .get('/auth/oauth/callback?code=code-123')
        .expect(302)
        .expect(
          'Location',
          'http://localhost:5173/auth/callback#access_token=access-token-123&refresh_token=refresh-token-123',
        );

      expect(mockAuthService.handleOauthCallback).toHaveBeenCalledWith({
        code: 'code-123',
        error: undefined,
      });
    });

    it('returns a 400 when the provider reports an error', async () => {
      mockAuthService.handleOauthCallback.mockRejectedValue(
        new BadRequestException(
          'OAuth provider rejected the authorization request',
        ),
      );

      await request(app.getHttpServer())
        .get('/auth/oauth/callback?error=access_denied')
        .expect(400);
    });
  });

  describe('POST /auth/refresh', () => {
    it('returns new tokens', async () => {
      mockAuthService.refresh.mockResolvedValue({
        accessToken: 'at-1',
        refreshToken: 'rt-1',
      });

      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: 'rt-0' })
        .expect(201);

      expect(mockAuthService.refresh).toHaveBeenCalledWith('rt-0');
      expect(res.body).toEqual({ accessToken: 'at-1', refreshToken: 'rt-1' });
    });
  });
});
