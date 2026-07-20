import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { AlertsService } from './alerts.service';
import { AlertDto } from './dto';
import { Roles } from '../auth/roles.decorator';

@ApiTags('alerts')
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Roles('TEACHER')
  @Get()
  @ApiOperation({ summary: "List alerts for teacher's classes" })
  @ApiQuery({ name: 'status', required: false })
  @ApiOkResponse({ type: AlertDto, isArray: true })
  findAll(@Query('status') status?: string) {
    return this.alertsService.findAll(status);
  }
}
