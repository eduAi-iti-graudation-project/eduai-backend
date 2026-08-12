import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClassesService } from './classes.service';
import { AssignClassTeacherDto, ClassDto } from './dto';
import {
  CreateSectionDto,
  UpdateSectionDto,
  AddSectionEnrollmentDto,
} from '../sections/dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

@ApiTags('classes')
@Controller('classes')
export class ClassesController {
  constructor(private readonly classesService: ClassesService) {}

  @Roles('ADMIN')
  @Post()
  @ApiOperation({ summary: 'Create a class within a grade level' })
  @ApiBody({ type: CreateSectionDto })
  @ApiOkResponse({ type: ClassDto })
  create(
    @Body() dto: CreateSectionDto,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.classesService.create(dto, organizationId);
  }

  @Roles('TEACHER', 'ADMIN')
  @Get()
  @ApiOperation({
    summary: 'List classes; teachers only see the sections they teach',
  })
  @ApiOkResponse({ type: ClassDto, isArray: true })
  findAll(
    @CurrentUser() user: { id: string; role: string; organizationId: string },
  ) {
    return this.classesService.findAll(user.organizationId, user);
  }

  @Roles('TEACHER', 'STUDENT', 'GUARDIAN', 'ADMIN')
  @Get(':id')
  @ApiOperation({ summary: 'Get a class with its roster and offerings' })
  @ApiOkResponse({ type: ClassDto })
  findOne(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.classesService.findOne(id, organizationId);
  }

  @Roles('ADMIN')
  @Patch(':id')
  @ApiOperation({ summary: 'Update a class' })
  @ApiBody({ type: UpdateSectionDto })
  @ApiOkResponse({ type: ClassDto })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSectionDto,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.classesService.update(id, dto, organizationId);
  }

  @Roles('ADMIN')
  @Delete(':id')
  @ApiOperation({ summary: 'Delete a class' })
  remove(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.classesService.remove(id, organizationId);
  }

  @Roles('ADMIN')
  @Post(':id/teacher')
  @ApiOperation({ summary: 'Assign a teacher to a class (via its offering)' })
  @ApiBody({ type: AssignClassTeacherDto })
  @ApiOkResponse({ type: ClassDto })
  assignTeacher(
    @Param('id') id: string,
    @Body() dto: AssignClassTeacherDto,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.classesService.assignTeacher(id, dto.teacherId, organizationId);
  }

  @Roles('TEACHER', 'ADMIN')
  @Post(':id/enrollments')
  @ApiOperation({ summary: 'Enroll a student in a class' })
  @ApiBody({ type: AddSectionEnrollmentDto })
  addEnrollment(
    @Param('id') id: string,
    @Body() dto: AddSectionEnrollmentDto,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.classesService.addEnrollment(id, dto.studentId, organizationId);
  }

  @Roles('TEACHER', 'ADMIN')
  @Delete(':sectionId/enrollments/:studentId')
  @ApiOperation({ summary: 'Remove a student from a class' })
  removeEnrollment(
    @Param('sectionId') sectionId: string,
    @Param('studentId') studentId: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.classesService.removeEnrollment(
      sectionId,
      studentId,
      organizationId,
    );
  }
}
