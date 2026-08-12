import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { ReportDto } from './dto';
import { RequiresTier } from '../auth/requires-tier.decorator';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '@prisma/client';

@ApiTags('reports')
@Controller('reports')
@RequiresTier('PRO', 'ENTERPRISE')
@Roles('TEACHER', 'STUDENT', 'GUARDIAN', 'ADMIN')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get()
  @ApiOperation({ summary: 'List reports, optionally filtered by student' })
  @ApiQuery({ name: 'studentId', required: false })
  @ApiOkResponse({ type: ReportDto, isArray: true })
  findAll(
    @Query('studentId') studentId: string | undefined,
    @CurrentUser() user: User,
  ) {
    return this.reportsService.findAll(user, studentId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single report by ID' })
  @ApiOkResponse({ type: ReportDto })
  findOne(@Param('id') id: string, @CurrentUser() user: User) {
    return this.reportsService.findOne(id, user);
  }
}
