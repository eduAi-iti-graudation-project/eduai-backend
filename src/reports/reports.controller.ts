import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiQuery,
  ApiProduces,
} from '@nestjs/swagger';
import type { Response } from 'express';
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

  @Get(':id/html')
  @ApiOperation({
    summary:
      'Get a report as a standalone, print-ready HTML document with the school logo',
  })
  @ApiProduces('text/html')
  @ApiQuery({
    name: 'download',
    required: false,
    description: 'Set to "true" to force a file download',
  })
  async html(
    @Param('id') id: string,
    @Query('download') download: string | undefined,
    @CurrentUser() user: User,
    @Res() res: Response,
  ) {
    const document = await this.reportsService.getHtmlDocument(id, user);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (download === 'true' || download === '1') {
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${document.filename}"`,
      );
    }
    res.send(document.html);
  }
}
