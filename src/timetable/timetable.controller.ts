import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { TimetableService } from './timetable.service';
import {
  CheckConflictQueryDto,
  CheckConflictResultDto,
  CreateTimetableSlotDto,
  UpdateTimetableSlotDto,
  TimetableSlotDto,
  TimetableSlotWithOfferingDto,
} from './dto';

@ApiTags('timetable')
@Controller('timetable')
export class TimetableController {
  constructor(private readonly timetableService: TimetableService) {}

  @Roles('ADMIN')
  @Post('slots')
  @ApiOperation({ summary: 'Create a timetable slot (rejects conflicts)' })
  @ApiBody({ type: CreateTimetableSlotDto })
  @ApiOkResponse({ type: TimetableSlotDto })
  create(
    @Body() dto: CreateTimetableSlotDto,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.timetableService.create(dto, organizationId);
  }

  @Roles('ADMIN')
  @Patch('slots/:id')
  @ApiOperation({
    summary: 'Update a timetable slot (rejects conflicts, excluding itself)',
  })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiBody({ type: UpdateTimetableSlotDto })
  @ApiOkResponse({ type: TimetableSlotDto })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTimetableSlotDto,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.timetableService.update(id, dto, organizationId);
  }

  @Roles('ADMIN')
  @Delete('slots/:id')
  @ApiOperation({ summary: 'Delete a timetable slot' })
  @ApiParam({ name: 'id', type: 'string' })
  remove(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.timetableService.remove(id, organizationId);
  }

  @Roles('ADMIN')
  @Get('slots')
  @ApiOperation({ summary: 'Get every timetable slot in the organization' })
  @ApiOkResponse({ type: TimetableSlotWithOfferingDto, isArray: true })
  allSlots(@CurrentUser('organizationId') organizationId: string) {
    return this.timetableService.listAll(organizationId);
  }

  @Roles('ADMIN')
  @Get('slots/check-conflict')
  @ApiOperation({
    summary:
      'Read-only conflict check for a proposed slot (same logic as create/update)',
  })
  @ApiQuery({ name: 'courseOfferingId', type: 'string', required: true })
  @ApiQuery({
    name: 'day',
    enum: [
      'MONDAY',
      'TUESDAY',
      'WEDNESDAY',
      'THURSDAY',
      'FRIDAY',
      'SATURDAY',
      'SUNDAY',
    ],
    required: true,
  })
  @ApiQuery({ name: 'start', type: 'string', required: true })
  @ApiQuery({ name: 'end', type: 'string', required: true })
  @ApiQuery({ name: 'excludeSlotId', type: 'string', required: false })
  @ApiOkResponse({ type: CheckConflictResultDto })
  checkConflict(
    @Query() query: CheckConflictQueryDto,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.timetableService.checkConflict(query, organizationId);
  }

  @Roles('ADMIN', 'TEACHER', 'STUDENT', 'GUARDIAN')
  @Get('sections/:sectionId')
  @ApiOperation({ summary: "Get a section's full weekly schedule" })
  @ApiParam({ name: 'sectionId', type: 'string' })
  @ApiOkResponse({ type: TimetableSlotWithOfferingDto, isArray: true })
  sectionSchedule(
    @Param('sectionId') sectionId: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.timetableService.listForSection(sectionId, organizationId);
  }

  @Roles('ADMIN', 'TEACHER', 'STUDENT', 'GUARDIAN')
  @Get('teachers/:teacherId')
  @ApiOperation({ summary: "Get a teacher's personal weekly schedule" })
  @ApiParam({ name: 'teacherId', type: 'string' })
  @ApiOkResponse({ type: TimetableSlotWithOfferingDto, isArray: true })
  teacherSchedule(
    @Param('teacherId') teacherId: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.timetableService.listForTeacher(teacherId, organizationId);
  }
}
