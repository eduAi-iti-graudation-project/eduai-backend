import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Request, Response } from 'express';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import type { OauthAuthorizeParams, RefreshDto } from './dto';

describe('AuthController', () => {
  let controller: AuthController;

  const mockAuthService = {
    getProviders: jest.fn(),
    getOauthAuthorizeUrl: jest.fn(),
    handleOauthCallback: jest.fn(),
    refresh: jest.fn(),
  };

  const originalFrontendUrl = process.env.FRONTEND_URL;

  function mockRequest(): Request {
    return {
      protocol: 'http',
      get: () => 'localhost:3000',
    } as unknown as Request;
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (originalFrontendUrl === undefined) {
      delete process.env.FRONTEND_URL;
    } else {
      process.env.FRONTEND_URL = originalFrontendUrl;
    }
  });

  describe('providers', () => {
    it('returns the env-configured allowlist', () => {
      const expected = {
        providers: [{ provider: 'google', enabled: true }],
      };
      mockAuthService.getProviders.mockReturnValue(expected);

      expect(controller.providers()).toEqual(expected);
      expect(mockAuthService.getProviders).toHaveBeenCalled();
    });
  });

  describe('authorize', () => {
    it('returns the provider authorization URL for a valid provider', async () => {
      const expected = { url: 'https://accounts.google.com/oauth' };
      mockAuthService.getOauthAuthorizeUrl.mockResolvedValue(expected);

      const result = await controller.authorize(
        { provider: 'google' } as OauthAuthorizeParams,
        mockRequest(),
      );

      expect(mockAuthService.getOauthAuthorizeUrl).toHaveBeenCalledWith(
        'google',
        'http://localhost:3000',
      );
      expect(result).toEqual(expected);
    });

    it('propagates a 400 for a provider not in the allowlist', async () => {
      mockAuthService.getOauthAuthorizeUrl.mockRejectedValue(
        new BadRequestException("Provider 'facebook' is not enabled"),
      );

      await expect(
        controller.authorize(
          { provider: 'facebook' } as OauthAuthorizeParams,
          mockRequest(),
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('oauthCallback', () => {
    it('redirects to the frontend with the session in the URL fragment', async () => {
      process.env.FRONTEND_URL = 'http://localhost:5173';
      mockAuthService.handleOauthCallback.mockResolvedValue({
        accessToken: 'access-token-123',
        refreshToken: 'refresh-token-123',
      });
      const res = { redirect: jest.fn() } as unknown as Response;

      await controller.oauthCallback(res, 'code-123', undefined);

      expect(mockAuthService.handleOauthCallback).toHaveBeenCalledWith({
        code: 'code-123',
        error: undefined,
      });
      expect(res.redirect).toHaveBeenCalledWith(
        302,
        'http://localhost:5173/auth/callback#access_token=access-token-123&refresh_token=refresh-token-123',
      );
    });

    it('propagates a 400 when the provider reports an error', async () => {
      mockAuthService.handleOauthCallback.mockRejectedValue(
        new BadRequestException('OAuth provider rejected the authorization request'),
      );
      const res = { redirect: jest.fn() } as unknown as Response;

      await expect(
        controller.oauthCallback(res, undefined, 'access_denied'),
      ).rejects.toThrow(BadRequestException);
      expect(res.redirect).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    it('returns new tokens', async () => {
      const expected = { accessToken: 'at-1', refreshToken: 'rt-1' };
      mockAuthService.refresh.mockResolvedValue(expected);

      const result = await controller.refresh({
        refreshToken: 'rt-0',
      } as RefreshDto);

      expect(mockAuthService.refresh).toHaveBeenCalledWith('rt-0');
      expect(result).toEqual(expected);
    });
  });
});
