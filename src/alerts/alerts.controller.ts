import { Controller, Get, Patch, Param, Body, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';
import { AlertsService } from './alerts.service';
import { AlertDto, ResolveAlertDto } from './dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

@ApiTags('alerts')
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Get()
  @Roles('TEACHER', 'ADMIN')
  @ApiOperation({ summary: "List alerts for teacher's classes" })
  @ApiQuery({ name: 'status', required: false })
  @ApiOkResponse({ type: AlertDto, isArray: true })
  findAll(
    @Query('status') status: string | undefined,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.alertsService.findAll(status, organizationId);
  }

  @Get('guardian')
  @Roles('GUARDIAN')
  @ApiOperation({ summary: "List ACTIVE alerts for the guardian's children" })
  @ApiOkResponse({ type: AlertDto, isArray: true })
  findByGuardian(@CurrentUser('id') guardianId: string) {
    return this.alertsService.findByGuardian(guardianId);
  }

  @Get(':id/teacher-detail')
  @Roles('TEACHER', 'ADMIN')
  @ApiOperation({ summary: 'Get structured analysis data for an alert' })
  getTeacherDetail(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.alertsService.getTeacherDetail(id, organizationId);
  }

  @Get(':id/guardian-detail')
  @Roles('GUARDIAN')
  @ApiOperation({ summary: 'Get guardian-facing alert content for a child' })
  getGuardianDetail(
    @Param('id') id: string,
    @CurrentUser('id') guardianId: string,
  ) {
    return this.alertsService.getGuardianDetail(id, guardianId);
  }

  @Patch(':id')
  @Roles('TEACHER', 'ADMIN')
  @ApiOperation({ summary: 'Resolve or dismiss an alert' })
  @ApiBody({ type: ResolveAlertDto })
  @ApiOkResponse({ type: AlertDto })
  resolve(
    @Param('id') id: string,
    @Body() dto: ResolveAlertDto,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.alertsService.resolve(id, dto.status, organizationId);
  }
}
