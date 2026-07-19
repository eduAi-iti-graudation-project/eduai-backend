import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse } from '@nestjs/swagger';
import { StudentsService } from './students.service';
import { GradeDto } from './dto';
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
}
