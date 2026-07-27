import { Controller, Get, Post, Delete, Param, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse, ApiBody } from '@nestjs/swagger';
import { GradesService } from './grades.service';
import {
  CreateGradeDto,
  AddGradeClassDto,
  GradeDto,
  GradeClassDto,
} from './dto';
import { Roles } from '../auth/roles.decorator';

@ApiTags('grades')
@Controller('grades')
export class GradesController {
  constructor(private readonly gradesService: GradesService) {}

  @Roles('TEACHER', 'ADMIN')
  @Get()
  @ApiOperation({ summary: 'List all grades' })
  @ApiOkResponse({ type: GradeDto, isArray: true })
  findAll() {
    return this.gradesService.findAll();
  }

  @Roles('TEACHER', 'ADMIN')
  @Get(':id')
  @ApiOperation({ summary: 'Get grade by ID with classes' })
  @ApiOkResponse({ type: GradeDto })
  findOne(@Param('id') id: string) {
    return this.gradesService.findOne(id);
  }

  @Roles('TEACHER', 'ADMIN')
  @Get(':id/classes')
  @ApiOperation({ summary: 'List classes in a grade' })
  @ApiOkResponse({ type: GradeClassDto, isArray: true })
  getClasses(@Param('id') id: string) {
    return this.gradesService.getClasses(id);
  }

  @Roles('ADMIN')
  @Post()
  @ApiOperation({ summary: 'Create a grade' })
  @ApiBody({ type: CreateGradeDto })
  @ApiOkResponse({ type: GradeDto })
  create(@Body() dto: CreateGradeDto) {
    return this.gradesService.create(dto);
  }

  @Roles('ADMIN')
  @Post(':id/classes')
  @ApiOperation({ summary: 'Add a class to a grade' })
  @ApiBody({ type: AddGradeClassDto })
  @ApiOkResponse({ type: GradeClassDto })
  addClass(@Param('id') id: string, @Body() dto: AddGradeClassDto) {
    return this.gradesService.addClass(id, dto.classId);
  }

  @Roles('ADMIN')
  @Delete(':gradeId/classes/:classId')
  @ApiOperation({ summary: 'Remove a class from a grade' })
  removeClass(
    @Param('gradeId') gradeId: string,
    @Param('classId') classId: string,
  ) {
    return this.gradesService.removeClass(gradeId, classId);
  }
}
