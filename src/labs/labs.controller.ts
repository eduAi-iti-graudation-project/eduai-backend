import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequiresTier } from '../auth/requires-tier.decorator';
import { Roles } from '../auth/roles.decorator';
import {
  GenerateLabDto,
  GenerateLabResponseDto,
  LabDto,
  RejectLabDto,
} from './dto';
import { LabsService } from './labs.service';

@ApiTags('labs')
@Controller('labs')
export class LabsController {
  constructor(private readonly labsService: LabsService) {}

  @Post('generate')
  @Roles('TEACHER')
  @RequiresTier('PRO', 'ENTERPRISE')
  @ApiOperation({
    summary:
      'Generate a lab simulation: grounds the topic in curriculum material, generates Matter.js code, and runs an AI security review before returning.',
  })
  @ApiOkResponse({ type: GenerateLabResponseDto })
  generate(@Body() dto: GenerateLabDto, @CurrentUser() user: User) {
    return this.labsService.generate(user, dto);
  }

  @Post(':id/publish')
  @Roles('TEACHER')
  @ApiOperation({
    summary: 'Publish a lab. Only allowed from PENDING_TEACHER_REVIEW.',
  })
  @ApiOkResponse({ type: LabDto })
  publish(@Param('id') id: string, @CurrentUser() user: User) {
    return this.labsService.publish(user, id);
  }

  @Post(':id/reject')
  @Roles('TEACHER')
  @ApiOperation({
    summary:
      'Reject a lab that has not reached a final status, with optional notes.',
  })
  @ApiOkResponse({ type: LabDto })
  reject(
    @Param('id') id: string,
    @Body() dto: RejectLabDto,
    @CurrentUser() user: User,
  ) {
    return this.labsService.reject(user, id, dto.notes);
  }

  @Get()
  @Roles('TEACHER', 'STUDENT')
  @ApiOperation({
    summary:
      'List labs. Teachers see their own labs (optionally filtered by course offering); students only ever see PUBLISHED labs in their enrolled offerings.',
  })
  @ApiOkResponse({ type: LabDto, isArray: true })
  list(
    @Query('courseOfferingId') courseOfferingId: string | undefined,
    @CurrentUser() user: User,
  ) {
    return this.labsService.listForUser(user, courseOfferingId);
  }

  @Get(':id')
  @Roles('TEACHER', 'STUDENT')
  @ApiOperation({
    summary:
      'Get one lab. Students can only retrieve PUBLISHED labs — a direct URL to a pending or rejected lab returns 404.',
  })
  @ApiOkResponse({ type: LabDto })
  get(@Param('id') id: string, @CurrentUser() user: User) {
    return this.labsService.getForUser(user, id);
  }
}
