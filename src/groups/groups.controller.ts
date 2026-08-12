import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { GroupsService } from './groups.service';
import { CreateGroupDto } from './dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '@prisma/client';

@ApiTags('groups')
@Controller('groups')
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  @Get('me')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Get the school group of the current school' })
  findMine(@CurrentUser() user: User) {
    return this.groupsService.findMine(user);
  }

  @Get('me/insights')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Aggregated usage insights per school in the group',
  })
  insights(@CurrentUser() user: User) {
    return this.groupsService.insights(user);
  }

  @Post()
  @Roles('ADMIN')
  @ApiOperation({
    summary:
      'Create a school group and move billing of the current school into it',
  })
  create(@CurrentUser() user: User, @Body() dto: CreateGroupDto) {
    return this.groupsService.create(user, dto.name);
  }
}
