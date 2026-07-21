import { Controller, Get, Patch, Param, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { NotificationDto } from './dto';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'List notifications for current user' })
  @ApiQuery({ name: 'userId', required: false })
  @ApiOkResponse({ type: NotificationDto, isArray: true })
  findAll(@Query('userId') userId?: string) {
    return this.notificationsService.findAll(userId);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark notification as read' })
  markRead(@Param('id') id: string) {
    return this.notificationsService.markRead(id);
  }
}
