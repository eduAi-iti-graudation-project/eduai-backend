import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse, ApiBody } from '@nestjs/swagger';
import { OfferingsService } from './offerings.service';
import { CreateOfferingDto, UpdateOfferingDto, OfferingDto } from './dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '@prisma/client';

@ApiTags('offerings')
@Controller('offerings')
export class OfferingsController {
  constructor(private readonly offeringsService: OfferingsService) {}

  @Roles('ADMIN')
  @Post()
  @ApiOperation({ summary: 'Create a course offering (assign a teacher)' })
  @ApiBody({ type: CreateOfferingDto })
  @ApiOkResponse({ type: OfferingDto })
  create(
    @Body() dto: CreateOfferingDto,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.offeringsService.create(dto, organizationId);
  }

  @Roles('TEACHER', 'STUDENT', 'GUARDIAN', 'ADMIN')
  @Get()
  @ApiOperation({
    summary: 'List all course offerings',
    description:
      'Optionally filter by courseId, or by teacherId (ADMIN only; teachers are always scoped to themselves).',
  })
  @ApiOkResponse({ type: OfferingDto, isArray: true })
  findAll(
    @CurrentUser() user: User,
    @Query('teacherId') teacherId?: string,
    @Query('courseId') courseId?: string,
  ) {
    const effectiveTeacherId =
      user.role === 'TEACHER'
        ? user.id
        : user.role === 'ADMIN'
          ? teacherId
          : undefined;
    return this.offeringsService.findAll(user.organizationId, {
      teacherId: effectiveTeacherId,
      courseId,
    });
  }

  @Roles('TEACHER', 'STUDENT', 'GUARDIAN', 'ADMIN')
  @Get(':id')
  @ApiOperation({
    summary: 'Get a course offering with its teacher and roster',
  })
  @ApiOkResponse({ type: OfferingDto })
  findOne(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.offeringsService.findOne(id, organizationId);
  }

  @Roles('ADMIN')
  @Patch(':id')
  @ApiOperation({ summary: 'Update a course offering (reassign teacher)' })
  @ApiBody({ type: UpdateOfferingDto })
  @ApiOkResponse({ type: OfferingDto })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateOfferingDto,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.offeringsService.update(id, dto, organizationId);
  }

  @Roles('ADMIN')
  @Delete(':id')
  @ApiOperation({ summary: 'Delete a course offering' })
  remove(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.offeringsService.remove(id, organizationId);
  }
}
