import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GradeConsoleService } from './grade-console.service';
import { AddClassToGradeDto } from './dto';
import { CreateGradeLevelDto, GradeLevelDto } from '../grade-levels/dto';
import { ClassDto } from '../classes/dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

@ApiTags('grades-console')
@Controller('grades')
export class GradeConsoleController {
  constructor(private readonly gradeConsoleService: GradeConsoleService) {}

  @Roles('TEACHER', 'ADMIN')
  @Get()
  @ApiOperation({ summary: 'List all grade levels (console)' })
  @ApiOkResponse({ type: GradeLevelDto, isArray: true })
  findAll(@CurrentUser('organizationId') organizationId: string) {
    return this.gradeConsoleService.findAll(organizationId);
  }

  @Roles('ADMIN')
  @Post()
  @ApiOperation({ summary: 'Create a grade level (console)' })
  @ApiBody({ type: CreateGradeLevelDto })
  @ApiOkResponse({ type: GradeLevelDto })
  create(
    @Body() dto: CreateGradeLevelDto,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.gradeConsoleService.create(dto, organizationId);
  }

  @Roles('TEACHER', 'ADMIN')
  @Get(':gradeId/classes')
  @ApiOperation({ summary: 'List classes inside a grade level' })
  @ApiOkResponse({ type: ClassDto, isArray: true })
  findGradeClasses(
    @Param('gradeId') gradeId: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.gradeConsoleService.getGradeClasses(gradeId, organizationId);
  }

  @Roles('ADMIN')
  @Post(':gradeId/classes')
  @ApiOperation({ summary: 'Add an existing class to a grade level' })
  @ApiBody({ type: AddClassToGradeDto })
  @ApiOkResponse({ type: ClassDto })
  addClassToGrade(
    @Param('gradeId') gradeId: string,
    @Body() dto: AddClassToGradeDto,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.gradeConsoleService.addClassToGrade(
      gradeId,
      dto.classId,
      organizationId,
    );
  }

  @Roles('ADMIN')
  @Delete(':gradeId/classes/:classId')
  @ApiOperation({ summary: 'Remove a class from a grade level' })
  removeClassFromGrade(
    @Param('gradeId') gradeId: string,
    @Param('classId') classId: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.gradeConsoleService.removeClassFromGrade(
      classId,
      organizationId,
    );
  }
}
