import { Controller, Get, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse, ApiBody } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { BroadcastsService } from './broadcasts.service';
import { CreateBroadcastDto, BroadcastDto } from './dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

@ApiTags('broadcasts')
@Controller('broadcasts')
export class BroadcastsController {
  constructor(private readonly broadcastsService: BroadcastsService) {}

  @Post()
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Create a broadcast and fan it out to its audience',
  })
  @ApiBody({ type: CreateBroadcastDto })
  @ApiOkResponse({ type: BroadcastDto })
  create(@CurrentUser() user: User, @Body() dto: CreateBroadcastDto) {
    return this.broadcastsService.create(user, dto);
  }

  @Get()
  @Roles('ADMIN')
  @ApiOperation({ summary: 'List broadcasts for the admin organization' })
  @ApiOkResponse({ type: BroadcastDto, isArray: true })
  findAll(@CurrentUser('organizationId') organizationId: string) {
    return this.broadcastsService.findAll(organizationId);
  }
}
