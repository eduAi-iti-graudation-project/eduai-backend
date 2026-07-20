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

  @Roles('TEACHER')
  @Post()
  @ApiOperation({ summary: 'Create a class' })
  @ApiBody({ type: CreateClassDto })
  @ApiOkResponse({ type: ClassDto })
  create(@Body() dto: CreateClassDto, @CurrentUser('id') teacherId: string) {
    return this.classesService.create(dto, teacherId);
  }

  @Roles('TEACHER', 'STUDENT', 'GUARDIAN')
  @Get()
  @ApiOperation({ summary: 'List all classes' })
  @ApiOkResponse({ type: ClassDto, isArray: true })
  findAll() {
    return this.classesService.findAll();
  }

  @Roles('TEACHER', 'STUDENT', 'GUARDIAN')
  @Get(':id')
  @ApiOperation({ summary: 'Get class by ID' })
  @ApiOkResponse({ type: ClassDto })
  findOne(@Param('id') id: string) {
    return this.classesService.findOne(id);
  }

  @Roles('TEACHER')
  @Patch(':id')
  @ApiOperation({ summary: 'Update a class' })
  @ApiBody({ type: UpdateClassDto })
  @ApiOkResponse({ type: ClassDto })
  update(@Param('id') id: string, @Body() dto: UpdateClassDto) {
    return this.classesService.update(id, dto);
  }

  @Roles('TEACHER')
  @Delete(':id')
  @ApiOperation({ summary: 'Delete a class' })
  remove(@Param('id') id: string) {
    return this.classesService.remove(id);
  }

  @Roles('TEACHER')
  @Post(':id/enrollments')
  @ApiOperation({ summary: 'Enroll a student' })
  @ApiBody({ type: AddEnrollmentDto })
  addEnrollment(@Param('id') id: string, @Body() dto: AddEnrollmentDto) {
    return this.classesService.addEnrollment(id, dto.studentId);
  }

  @Roles('TEACHER')
  @Delete(':classId/enrollments/:studentId')
  @ApiOperation({ summary: 'Remove a student enrollment' })
  removeEnrollment(
    @Param('classId') classId: string,
    @Param('studentId') studentId: string,
  ) {
    return this.classesService.removeEnrollment(classId, studentId);
  }
}
