import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Req,
  Res,
  HttpStatus,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiBody,
  ApiParam,
  ApiQuery,
  ApiConsumes,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AuthService } from './auth.service';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';
import { ErrorHint } from '../common/errors/hints';
import {
  SignupDto,
  TeacherSignupDto,
  LoginDto,
  UserDto,
  AuthResponseDto,
  RefreshDto,
  OauthAuthorizeParams,
  ProvidersResponseDto,
  OauthAuthorizeResponseDto,
  RefreshResponseDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  ChangePasswordDto,
  VerifyEmailDto,
  ResendCredentialsDto,
  OauthOnboardDto,
} from './dto';
import { Public } from './public.decorator';
import { CurrentUser } from './current-user.decorator';
import { SkipSubscriptionCheck } from './skip-subscription.decorator';
import { Roles } from './roles.decorator';

@ApiTags('auth')
@SkipSubscriptionCheck()
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
  @Post('signup/teacher')
  @UseInterceptors(
    FileInterceptor('photo', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Teacher joins a school with personal details and photo',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        photo: { type: 'string', format: 'binary' },
        name: { type: 'string' },
        email: { type: 'string' },
        password: { type: 'string' },
        joinCode: { type: 'string' },
        ssn: { type: 'string' },
        phone: { type: 'string' },
        street: { type: 'string' },
        city: { type: 'string' },
        nationality: { type: 'string' },
        personalEmail: { type: 'string' },
        dateOfBirth: { type: 'string' },
        emergencyContactName: { type: 'string' },
        emergencyContactPhone: { type: 'string' },
        emergencyContactRelationship: { type: 'string' },
      },
      required: [
        'photo',
        'name',
        'email',
        'password',
        'joinCode',
        'ssn',
        'phone',
        'street',
        'city',
        'dateOfBirth',
      ],
    },
  })
  @ApiOkResponse({ description: 'Pending teacher membership request' })
  signupTeacher(
    @Body() dto: TeacherSignupDto,
    @UploadedFile() photo: Express.Multer.File | undefined,
  ) {
    return this.authService.signupTeacher(dto, photo);
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

  @Public()
  @Post('forgot-password')
  @ApiOperation({ summary: 'Send a password reset link to an email address' })
  @ApiBody({ type: ForgotPasswordDto })
  forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Req() req: Request,
  ): Promise<{ message: string }> {
    const origin = `${req.protocol}://${req.get('host')}`;
    return this.authService.forgotPassword({ email: dto.email, origin });
  }

  @Public()
  @Post('reset-password')
  @ApiOperation({
    summary: 'Set a new password using a reset link access token',
  })
  @ApiBody({ type: ResetPasswordDto })
  resetPassword(
    @Body() dto: ResetPasswordDto,
    @Req() req: Request,
  ): Promise<{ accessToken: string; user: unknown }> {
    const origin = `${req.protocol}://${req.get('host')}`;
    return this.authService.resetPassword({
      token: dto.token,
      password: dto.password,
      origin,
    });
  }

  @Post('change-password')
  @ApiOperation({ summary: 'Change the current user password' })
  @ApiBody({ type: ChangePasswordDto })
  changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() user: { id: string; email: string; authId: string },
  ): Promise<{ message: string }> {
    return this.authService.changePassword({
      email: user.email,
      authId: user.authId,
      currentPassword: dto.currentPassword,
      newPassword: dto.newPassword,
    });
  }

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiOkResponse({ type: UserDto })
  me(@CurrentUser('id') userId: string) {
    return this.authService.me(userId);
  }

  @Public()
  @Post('verify-email')
  @ApiOperation({
    summary:
      'Verify an invite link token and reveal the school login credentials once',
  })
  @ApiBody({ type: VerifyEmailDto })
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto.token);
  }

  @Public()
  @Post('credentials/resend')
  @ApiOperation({
    summary:
      'Re-send the reveal email with the school login to the real inbox (verified users only)',
  })
  @ApiBody({ type: ResendCredentialsDto })
  resendCredentials(@Body() dto: ResendCredentialsDto) {
    return this.authService.resendCredentials(dto.personalEmail);
  }

  @Roles('ADMIN')
  @Post('oauth/onboard')
  @ApiOperation({
    summary:
      'Finish OAuth onboarding for an org-less admin (create or join a school)',
  })
  @ApiBody({ type: OauthOnboardDto })
  oauthOnboard(
    @Body() dto: OauthOnboardDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.authService.oauthOnboard(userId, dto);
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
