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
import { CoursesService } from './courses.service';
import { CreateCourseDto, UpdateCourseDto, CourseDto } from './dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

@ApiTags('courses')
@Controller('courses')
export class CoursesController {
  constructor(private readonly coursesService: CoursesService) {}

  @Roles('ADMIN')
  @Post()
  @ApiOperation({ summary: 'Create a course within a grade level' })
  @ApiBody({ type: CreateCourseDto })
  @ApiOkResponse({ type: CourseDto })
  create(
    @Body() dto: CreateCourseDto,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.coursesService.create(dto, organizationId);
  }

  @Roles('TEACHER', 'STUDENT', 'GUARDIAN', 'ADMIN')
  @Get()
  @ApiOperation({ summary: 'List all courses' })
  @ApiOkResponse({ type: CourseDto, isArray: true })
  findAll(@CurrentUser('organizationId') organizationId: string) {
    return this.coursesService.findAll(organizationId);
  }

  @Roles('TEACHER', 'ADMIN')
  @Get(':id')
  @ApiOperation({ summary: 'Get a course with its offerings' })
  @ApiOkResponse({ type: CourseDto })
  findOne(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.coursesService.findOne(id, organizationId);
  }

  @Roles('ADMIN')
  @Patch(':id')
  @ApiOperation({ summary: 'Update a course' })
  @ApiBody({ type: UpdateCourseDto })
  @ApiOkResponse({ type: CourseDto })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCourseDto,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.coursesService.update(id, dto, organizationId);
  }

  @Roles('ADMIN')
  @Delete(':id')
  @ApiOperation({ summary: 'Delete a course' })
  remove(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.coursesService.remove(id, organizationId);
  }
}
