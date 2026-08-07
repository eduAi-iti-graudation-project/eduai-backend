import { Controller, Get, Query, Delete, Param } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiQuery,
  ApiOkResponse,
  ApiNotFoundResponse,
  ApiConflictResponse,
  ApiInternalServerErrorResponse,
} from '@nestjs/swagger';
import { UsersService } from './users.service';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

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
  @ApiOkResponse({
    description:
      'List of users in the organization with basic info plus linked grade and guardian.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          email: { type: 'string' },
          name: { type: 'string' },
          role: {
            type: 'string',
            enum: ['TEACHER', 'STUDENT', 'GUARDIAN', 'ADMIN'],
          },
          gradeId: { type: 'string', nullable: true },
          guardianId: { type: 'string', nullable: true },
          organizationId: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
          grade: {
            type: 'object',
            nullable: true,
            properties: {
              id: { type: 'string' },
              level: { type: 'integer' },
              name: { type: 'string', nullable: true },
            },
          },
          guardian: {
            type: 'object',
            nullable: true,
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              email: { type: 'string' },
            },
          },
        },
      },
    },
  })
  findAll(
    @Query('role') role?: string,
    @Query('q') q?: string,
    @CurrentUser('organizationId') organizationId?: string,
  ) {
    return this.usersService.findAll({ role, q }, organizationId!);
  }

  @Roles('ADMIN')
  @Get(':id')
  @ApiOperation({ summary: 'Get full user details (ADMIN only)' })
  @ApiOkResponse({
    description:
      'Role-aware user details: grade/guardian/enrollments for students, taught grades/classes for teachers, wards for guardians, plus activity counts.',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        email: { type: 'string' },
        name: { type: 'string' },
        role: {
          type: 'string',
          enum: ['TEACHER', 'STUDENT', 'GUARDIAN', 'ADMIN'],
        },
        organizationId: { type: 'string' },
        hasAuthAccount: { type: 'boolean' },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
      additionalProperties: true,
    },
  })
  @ApiNotFoundResponse({ description: 'User not found in this organization.' })
  findOne(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId?: string,
  ) {
    return this.usersService.findOne(id, organizationId!);
  }

  @Roles('ADMIN')
  @Delete(':id')
  @ApiOperation({ summary: 'Delete a user (ADMIN only)' })
  @ApiOkResponse({
    description: 'User deleted. Their Supabase auth account is removed too.',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        email: { type: 'string' },
        name: { type: 'string' },
        role: {
          type: 'string',
          enum: ['TEACHER', 'STUDENT', 'GUARDIAN', 'ADMIN'],
        },
        deletedAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'User not found in this organization.' })
  @ApiConflictResponse({
    description:
      'Cannot delete an admin account or a teacher who still teaches classes.',
  })
  @ApiInternalServerErrorResponse({
    description: 'Could not remove the linked Supabase auth account.',
  })
  remove(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId?: string,
    @CurrentUser('id') adminId?: string,
  ) {
    return this.usersService.remove(id, organizationId!, adminId!);
  }
}
