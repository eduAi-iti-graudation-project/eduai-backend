import { Controller, Get, Param, Query, HttpStatus } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';
import { InsightsService } from './insights.service';
import { Roles } from '../auth/roles.decorator';
import { AllowGuardianless } from '../auth/allow-guardianless.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequiresTier } from '../auth/requires-tier.decorator';
import type { User } from '@prisma/client';
import {
  InsightsQuerySchema,
  InsightsResponseDto,
  SectionDetailQuerySchema,
  SectionDetailDto,
} from './dto';

@ApiTags('dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly insightsService: InsightsService,
  ) {}

  @Get('overview')
  @Roles('TEACHER', 'STUDENT', 'GUARDIAN', 'ADMIN')
  @AllowGuardianless()
  @ApiOperation({ summary: 'Role-aware dashboard overview' })
  @ApiOkResponse({
    description: 'Role-aware dashboard data — shape varies by role',
  })
  getOverview(@CurrentUser() user: User) {
    return this.dashboardService.getOverview(user);
  }

  @Get('insights')
  @Roles('TEACHER', 'STUDENT', 'GUARDIAN', 'ADMIN')
  @AllowGuardianless()
  @RequiresTier('ENTERPRISE')
  @ApiOperation({ summary: 'Role-aware dashboard insights' })
  @ApiQuery({
    name: 'interval',
    required: false,
    enum: ['week', 'month'],
    description: 'Bucket interval — defaults to week',
  })
  @ApiOkResponse({
    type: InsightsResponseDto,
    description: 'Role-scoped insights: sections with chart types + deltas',
  })
  getInsights(@CurrentUser() user: User, @Query('interval') interval?: string) {
    const parsed = InsightsQuerySchema.safeParse({ interval });
    if (!parsed.success) {
      throw new ApiError(
        ErrorCode.VALIDATION_FAILED,
        HttpStatus.BAD_REQUEST,
        'The interval must be "week" or "month".',
      );
    }
    return this.insightsService.getInsights(user, parsed.data.interval);
  }

  @Get('insights/students/:id')
  @Roles('TEACHER', 'STUDENT', 'GUARDIAN', 'ADMIN')
  @RequiresTier('ENTERPRISE')
  @ApiOperation({ summary: 'Per-student insights drill-down' })
  @ApiQuery({
    name: 'interval',
    required: false,
    enum: ['week', 'month'],
    description: 'Bucket interval — defaults to week',
  })
  @ApiOkResponse({
    type: InsightsResponseDto,
    description: 'Student-scoped insights; 403 when the caller has no access',
  })
  getStudentInsights(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Query('interval') interval?: string,
  ) {
    const parsed = InsightsQuerySchema.safeParse({ interval });
    if (!parsed.success) {
      throw new ApiError(
        ErrorCode.VALIDATION_FAILED,
        HttpStatus.BAD_REQUEST,
        'The interval must be "week" or "month".',
      );
    }
    return this.insightsService.getStudentInsights(
      user,
      id,
      parsed.data.interval,
    );
  }

  @Get('insights/sections/:sectionKey/detail')
  @Roles('TEACHER', 'STUDENT', 'GUARDIAN', 'ADMIN')
  @AllowGuardianless()
  @RequiresTier('ENTERPRISE')
  @ApiOperation({ summary: 'Underlying records for one insight chart point' })
  @ApiQuery({
    name: 'interval',
    required: false,
    enum: ['week', 'month'],
    description: 'Bucket interval — defaults to week',
  })
  @ApiQuery({
    name: 'bucket',
    required: true,
    description: 'The clicked chart point label (bucket date or category)',
  })
  @ApiOkResponse({
    type: SectionDetailDto,
    description:
      'Records behind a single chart point (or category) for the caller role',
  })
  getSectionDetail(
    @CurrentUser() user: User,
    @Param('sectionKey') sectionKey: string,
    @Query('interval') interval?: string,
    @Query('bucket') bucket?: string,
  ) {
    const parsed = SectionDetailQuerySchema.safeParse({ interval, bucket });
    if (!parsed.success) {
      throw new ApiError(
        ErrorCode.VALIDATION_FAILED,
        HttpStatus.BAD_REQUEST,
        'Provide a valid interval and a non-empty bucket label.',
      );
    }
    return this.insightsService.getSectionDetail(
      user,
      parsed.data.interval,
      sectionKey,
      parsed.data.bucket,
    );
  }

  @Get('insights/students/:id/sections/:sectionKey/detail')
  @Roles('TEACHER', 'STUDENT', 'GUARDIAN', 'ADMIN')
  @RequiresTier('ENTERPRISE')
  @ApiOperation({
    summary: 'Underlying records for one student insight chart point',
  })
  @ApiQuery({
    name: 'interval',
    required: false,
    enum: ['week', 'month'],
    description: 'Bucket interval — defaults to week',
  })
  @ApiQuery({
    name: 'bucket',
    required: true,
    description: 'The clicked chart point label (bucket date or category)',
  })
  @ApiOkResponse({
    type: SectionDetailDto,
    description:
      'Records behind a single student insight chart point; 403 when the caller has no access',
  })
  getStudentSectionDetail(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Param('sectionKey') sectionKey: string,
    @Query('interval') interval?: string,
    @Query('bucket') bucket?: string,
  ) {
    const parsed = SectionDetailQuerySchema.safeParse({ interval, bucket });
    if (!parsed.success) {
      throw new ApiError(
        ErrorCode.VALIDATION_FAILED,
        HttpStatus.BAD_REQUEST,
        'Provide a valid interval and a non-empty bucket label.',
      );
    }
    return this.insightsService.getStudentSectionDetail(
      user,
      id,
      parsed.data.interval,
      sectionKey,
      parsed.data.bucket,
    );
  }
}
