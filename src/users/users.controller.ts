import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { Roles } from '../auth/roles.decorator';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Roles('ADMIN')
  @Get()
  @ApiOperation({ summary: 'List/search users (ADMIN only)' })
  @ApiQuery({
    name: 'role',
    required: false,
    enum: ['TEACHER', 'STUDENT', 'GUARDIAN', 'ADMIN'],
  })
  @ApiQuery({
    name: 'q',
    required: false,
    description: 'Free-text name search',
  })
  findAll(@Query('role') role?: string, @Query('q') q?: string) {
    return this.usersService.findAll({ role, q });
  }
}
