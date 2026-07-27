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

@ApiTags('alerts')
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Get()
  @Roles('TEACHER', 'ADMIN')
  @ApiOperation({ summary: "List alerts for teacher's classes" })
  @ApiQuery({ name: 'status', required: false })
  @ApiOkResponse({ type: AlertDto, isArray: true })
  findAll(@Query('status') status?: string) {
    return this.alertsService.findAll(status);
  }

  @Patch(':id')
  @Roles('TEACHER', 'ADMIN')
  @ApiOperation({ summary: 'Resolve or dismiss an alert' })
  @ApiBody({ type: ResolveAlertDto })
  @ApiOkResponse({ type: AlertDto })
  resolve(@Param('id') id: string, @Body() dto: ResolveAlertDto) {
    return this.alertsService.resolve(id, dto.status);
  }
}
