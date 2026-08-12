import { Controller, Get, Patch, Post, Param, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { GuardianService } from './guardian.service';
import { UpdateGuardianProfileDto } from './dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

@ApiTags('guardian')
@Controller('guardian')
@Roles('GUARDIAN')
export class GuardianController {
  constructor(private readonly guardianService: GuardianService) {}

  @Get('wards')
  @ApiOperation({ summary: 'Guardian ward cards (multi-child)' })
  wards(@CurrentUser() user: User) {
    return this.guardianService.wards(user);
  }

  @Get('wards/:id/insights')
  @ApiOperation({
    summary:
      'Per-child insights: grades, attendance, quizzes, fees and open alerts',
  })
  wardInsights(@CurrentUser() user: User, @Param('id') studentId: string) {
    return this.guardianService.wardInsights(user, studentId);
  }

  @Get('me/profile')
  @ApiOperation({
    summary:
      'Get the guardian profile (requiresCompletion when details are missing)',
  })
  getProfile(@CurrentUser() user: User) {
    return this.guardianService.profile(user);
  }

  @Patch('me/profile')
  @ApiOperation({ summary: 'Complete / update the guardian profile' })
  @ApiBody({ type: UpdateGuardianProfileDto })
  updateProfile(
    @CurrentUser() user: User,
    @Body() dto: UpdateGuardianProfileDto,
  ) {
    return this.guardianService.updateProfile(user, dto);
  }

  @Post('me/resend')
  @ApiOperation({
    summary: 'Resend the login reveal to the guardian personal email',
  })
  resendReveal(@CurrentUser() user: User) {
    return this.guardianService.resendReveal(user);
  }
}
