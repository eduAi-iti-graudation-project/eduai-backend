import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { AlertsService } from './alerts.service';
import { AlertDto } from './dto';

@ApiTags('alerts')
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Get()
  @ApiOperation({ summary: "List alerts for teacher's classes" })
  @ApiQuery({ name: 'status', required: false })
  @ApiOkResponse({ type: AlertDto, isArray: true })
  findAll(@Query('status') status?: string) {
    return this.alertsService.findAll(status);
  }
}
