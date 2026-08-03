import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Req,
  Res,
  InternalServerErrorException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiBody,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import {
  SignupDto,
  LoginDto,
  UserDto,
  AuthResponseDto,
  RefreshDto,
  OauthAuthorizeParams,
  ProvidersResponseDto,
  OauthAuthorizeResponseDto,
  RefreshResponseDto,
} from './dto';
import { Public } from './public.decorator';
import { CurrentUser } from './current-user.decorator';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('signup')
  @ApiOperation({ summary: 'Register a new user' })
  @ApiBody({ type: SignupDto })
  @ApiOkResponse({ type: AuthResponseDto })
  signup(@Body() dto: SignupDto) {
    return this.authService.signup(dto);
  }

  @Public()
  @Post('login')
  @ApiOperation({ summary: 'Log in with email and password' })
  @ApiBody({ type: LoginDto })
  @ApiOkResponse({ type: AuthResponseDto })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Public()
  @Get('providers')
  @ApiOperation({ summary: 'List enabled third-party OAuth providers' })
  @ApiOkResponse({ type: ProvidersResponseDto })
  providers() {
    return this.authService.getProviders();
  }

  @Public()
  @Post('oauth/:provider/authorize')
  @ApiOperation({ summary: 'Start an OAuth login flow for a provider' })
  @ApiParam({ name: 'provider', schema: { enum: ['google', 'microsoft'] } })
  @ApiOkResponse({ type: OauthAuthorizeResponseDto })
  async authorize(
    @Param() params: OauthAuthorizeParams,
    @Req() req: Request,
  ): Promise<OauthAuthorizeResponseDto> {
    const origin = `${req.protocol}://${req.get('host')}`;
    return this.authService.getOauthAuthorizeUrl(params.provider, origin);
  }

  @Public()
  @Get('oauth/callback')
  @ApiOperation({
    summary:
      'OAuth callback — exchanges the code and redirects to the frontend',
  })
  @ApiQuery({ name: 'code', required: false })
  @ApiQuery({ name: 'error', required: false })
  async oauthCallback(
    @Res({ passthrough: true }) res: Response,
    @Query('code') code?: string,
    @Query('error') error?: string,
  ): Promise<void> {
    const { accessToken, refreshToken } =
      await this.authService.handleOauthCallback({ code, error });
    const frontendUrl = process.env.FRONTEND_URL;
    if (!frontendUrl) {
      throw new InternalServerErrorException('FRONTEND_URL is not set');
    }
    res.redirect(
      302,
      `${frontendUrl}/auth/callback#access_token=${encodeURIComponent(
        accessToken,
      )}&refresh_token=${encodeURIComponent(refreshToken)}`,
    );
  }

  @Public()
  @Post('refresh')
  @ApiOperation({ summary: 'Refresh an access token using a refresh token' })
  @ApiBody({ type: RefreshDto })
  @ApiOkResponse({ type: RefreshResponseDto })
  refresh(@Body() dto: RefreshDto): Promise<RefreshResponseDto> {
    return this.authService.refresh(dto.refreshToken);
  }

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiOkResponse({ type: UserDto })
  me(@CurrentUser('id') userId: string) {
    return this.authService.me(userId);
  }

  @Post('logout')
  @ApiOperation({ summary: 'Log out and revoke current session' })
  async logout(
    @CurrentUser('authId') authId: string,
  ): Promise<{ message: string }> {
    await this.authService.logout(authId);
    return { message: 'Logged out successfully' };
  }
}
