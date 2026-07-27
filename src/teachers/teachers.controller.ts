import { Controller, Get, Post, Delete, Param, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody, ApiOkResponse } from '@nestjs/swagger';
import { TeachersService } from './teachers.service';
import { AddTeacherGradeDto } from './dto';
import { Roles } from '../auth/roles.decorator';

@ApiTags('teachers')
@Controller('teachers')
export class TeachersController {
  constructor(private readonly teachersService: TeachersService) {}

  @Roles('TEACHER', 'ADMIN')
  @Get(':id/grades')
  @ApiOperation({ summary: 'List grades assigned to a teacher' })
  @ApiOkResponse({ description: 'List of grades' })
  getGrades(@Param('id') id: string) {
    return this.teachersService.getGrades(id);
  }

  @Roles('ADMIN')
  @Post(':id/grades')
  @ApiOperation({ summary: 'Assign a grade to a teacher' })
  @ApiBody({ type: AddTeacherGradeDto })
  @ApiOkResponse({ description: 'Grade assigned' })
  addGrade(@Param('id') id: string, @Body() dto: AddTeacherGradeDto) {
    return this.teachersService.addGrade(id, dto.gradeId);
  }

  @Roles('ADMIN')
  @Delete(':teacherId/grades/:gradeId')
  @ApiOperation({ summary: 'Remove a grade from a teacher' })
  @ApiOkResponse({ description: 'Grade removed' })
  removeGrade(
    @Param('teacherId') teacherId: string,
    @Param('gradeId') gradeId: string,
  ) {
    return this.teachersService.removeGrade(teacherId, gradeId);
  }
}
