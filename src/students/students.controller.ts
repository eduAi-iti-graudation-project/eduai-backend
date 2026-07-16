import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse } from '@nestjs/swagger';
import { StudentsService } from './students.service';
import { GradeDto } from './dto';

@ApiTags('students')
@Controller('students')
export class StudentsController {
  constructor(private readonly studentsService: StudentsService) {}

  @Get(':id/grades')
  @ApiOperation({ summary: 'Get confirmed grades for a student' })
  @ApiOkResponse({ type: GradeDto, isArray: true })
  getGrades(@Param('id') id: string) {
    return this.studentsService.getGrades(id);
  }
}
