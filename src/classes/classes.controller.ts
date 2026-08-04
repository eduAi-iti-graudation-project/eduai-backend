import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse, ApiBody } from '@nestjs/swagger';
import { ClassesService } from './classes.service';
import {
  CreateClassDto,
  UpdateClassDto,
  AddEnrollmentDto,
  ClassDto,
} from './dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

@ApiTags('classes')
@Controller('classes')
export class ClassesController {
  constructor(private readonly classesService: ClassesService) {}

  @Roles('ADMIN')
  @Post()
  @ApiOperation({ summary: 'Create a class (admin only, specify teacherId)' })
  @ApiBody({ type: CreateClassDto })
  @ApiOkResponse({ type: ClassDto })
  create(
    @Body() dto: CreateClassDto,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.classesService.create(dto, dto.teacherId, organizationId);
  }

  @Roles('TEACHER', 'STUDENT', 'GUARDIAN', 'ADMIN')
  @Get()
  @ApiOperation({ summary: 'List all classes' })
  @ApiOkResponse({ type: ClassDto, isArray: true })
  findAll(@CurrentUser('organizationId') organizationId: string) {
    return this.classesService.findAll(organizationId);
  }

  @Roles('STUDENT')
  @Get('available')
  @ApiOperation({ summary: 'List available classes for self-enrollment' })
  findAvailable(@CurrentUser('id') studentId: string) {
    return this.classesService.findAvailable(studentId);
  }

  @Roles('TEACHER', 'STUDENT', 'GUARDIAN', 'ADMIN')
  @Get(':id')
  @ApiOperation({ summary: 'Get class by ID' })
  @ApiOkResponse({ type: ClassDto })
  findOne(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.classesService.findOne(id, organizationId);
  }

  @Roles('TEACHER', 'ADMIN')
  @Patch(':id')
  @ApiOperation({ summary: 'Update a class' })
  @ApiBody({ type: UpdateClassDto })
  @ApiOkResponse({ type: ClassDto })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateClassDto,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.classesService.update(id, dto, organizationId);
  }

  @Roles('TEACHER', 'ADMIN')
  @Delete(':id')
  @ApiOperation({ summary: 'Delete a class' })
  remove(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.classesService.remove(id, organizationId);
  }

  @Roles('TEACHER')
  @Post(':id/enrollments')
  @ApiOperation({ summary: 'Enroll a student' })
  @ApiBody({ type: AddEnrollmentDto })
  addEnrollment(
    @Param('id') id: string,
    @Body() dto: AddEnrollmentDto,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.classesService.addEnrollment(id, dto.studentId, organizationId);
  }

  @Roles('STUDENT')
  @Post(':id/join')
  @ApiOperation({ summary: 'Student self-join class' })
  join(@Param('id') id: string, @CurrentUser('id') studentId: string) {
    return this.classesService.joinClass(id, studentId);
  }

  @Roles('TEACHER')
  @Get(':id/requests')
  @ApiOperation({ summary: 'List pending enrollment requests' })
  getRequests(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.classesService.getRequests(id, organizationId);
  }

  @Roles('TEACHER')
  @Delete(':classId/enrollments/:studentId')
  @ApiOperation({ summary: 'Remove a student enrollment' })
  removeEnrollment(
    @Param('classId') classId: string,
    @Param('studentId') studentId: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.classesService.removeEnrollment(
      classId,
      studentId,
      organizationId,
    );
  }
}
