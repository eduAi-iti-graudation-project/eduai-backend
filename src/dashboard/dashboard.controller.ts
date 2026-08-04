import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { InsightsService } from './insights.service';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequiresTier } from '../auth/requires-tier.decorator';
import type { User } from '@prisma/client';
import { InsightsQuerySchema, InsightsResponseDto } from './dto';

@ApiTags('dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly insightsService: InsightsService,
  ) {}

  @Get('overview')
  @Roles('TEACHER', 'STUDENT', 'GUARDIAN', 'ADMIN')
  @ApiOperation({ summary: 'Role-aware dashboard overview' })
  @ApiOkResponse({
    description: 'Role-aware dashboard data — shape varies by role',
  })
  getOverview(@CurrentUser() user: User) {
    return this.dashboardService.getOverview(user);
  }

  @Get('insights')
  @Roles('TEACHER', 'STUDENT', 'GUARDIAN', 'ADMIN')
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
      throw new BadRequestException('interval must be "week" or "month"');
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
      throw new BadRequestException('interval must be "week" or "month"');
    }
    return this.insightsService.getStudentInsights(
      user,
      id,
      parsed.data.interval,
    );
  }
}
