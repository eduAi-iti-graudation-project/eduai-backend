import { Controller, Get, Post, Patch, Param, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse, ApiBody } from '@nestjs/swagger';
import { StudentsService } from './students.service';
import { GradeDto, UpdateStudentDto } from './dto';
import { Roles } from '../auth/roles.decorator';

@ApiTags('students')
@Controller('students')
export class StudentsController {
  constructor(private readonly studentsService: StudentsService) {}

  @Roles('STUDENT', 'GUARDIAN')
  @Get(':id/grades')
  @ApiOperation({ summary: 'Get confirmed grades for a student' })
  @ApiOkResponse({ type: GradeDto, isArray: true })
  getGrades(@Param('id') id: string) {
    return this.studentsService.getGrades(id);
  }

  @Roles('STUDENT', 'GUARDIAN')
  @Get(':id/grades/:submissionId')
  @ApiOperation({ summary: 'Get confirmed grades for a specific submission' })
  @ApiOkResponse({ type: GradeDto, isArray: true })
  getSubmissionGrades(
    @Param('id') id: string,
    @Param('submissionId') submissionId: string,
  ) {
    return this.studentsService.getSubmissionGrades(id, submissionId);
  }

  @Roles('STUDENT', 'GUARDIAN')
  @Get(':id/classes')
  @ApiOperation({ summary: 'Get enrolled classes for a student' })
  getClasses(@Param('id') id: string) {
    return this.studentsService.getClasses(id);
  }

  @Roles('ADMIN')
  @Patch(':id')
  @ApiOperation({ summary: 'Update student details' })
  @ApiBody({ type: UpdateStudentDto })
  update(@Param('id') id: string, @Body() dto: UpdateStudentDto) {
    return this.studentsService.update(id, dto);
  }

  @Roles('ADMIN')
  @Post(':id/guardian')
  @ApiOperation({ summary: 'Link a guardian to a student' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { guardianId: { type: 'string', format: 'uuid' } },
    },
  })
  linkGuardian(
    @Param('id') id: string,
    @Body('guardianId') guardianId: string,
  ) {
    return this.studentsService.linkGuardian(id, guardianId);
  }
}
