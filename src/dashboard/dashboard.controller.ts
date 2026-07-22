import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '@prisma/client';

@ApiTags('dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('overview')
  @Roles('TEACHER', 'STUDENT', 'GUARDIAN', 'ADMIN')
  @ApiOperation({ summary: 'Role-aware dashboard overview' })
  @ApiOkResponse({
    description: 'Role-aware dashboard data — shape varies by role',
  })
  getOverview(@CurrentUser() user: User) {
    return this.dashboardService.getOverview(user);
  }
}
