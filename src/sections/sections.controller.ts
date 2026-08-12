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
import { SectionsService } from './sections.service';
import {
  CreateSectionDto,
  UpdateSectionDto,
  AddSectionEnrollmentDto,
  SectionDto,
} from './dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

@ApiTags('sections')
@Controller('sections')
export class SectionsController {
  constructor(private readonly sectionsService: SectionsService) {}

  @Roles('ADMIN')
  @Post()
  @ApiOperation({ summary: 'Create a section within a grade level' })
  @ApiBody({ type: CreateSectionDto })
  @ApiOkResponse({ type: SectionDto })
  create(
    @Body() dto: CreateSectionDto,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.sectionsService.create(dto, organizationId);
  }

  @Roles('TEACHER', 'ADMIN')
  @Get()
  @ApiOperation({ summary: 'List all sections' })
  @ApiOkResponse({ type: SectionDto, isArray: true })
  findAll(@CurrentUser('organizationId') organizationId: string) {
    return this.sectionsService.findAll(organizationId);
  }

  @Roles('TEACHER', 'STUDENT', 'GUARDIAN', 'ADMIN')
  @Get(':id')
  @ApiOperation({ summary: 'Get a section with its roster' })
  @ApiOkResponse({ type: SectionDto })
  findOne(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.sectionsService.findOne(id, organizationId);
  }

  @Roles('ADMIN')
  @Patch(':id')
  @ApiOperation({ summary: 'Update a section' })
  @ApiBody({ type: UpdateSectionDto })
  @ApiOkResponse({ type: SectionDto })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSectionDto,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.sectionsService.update(id, dto, organizationId);
  }

  @Roles('ADMIN')
  @Delete(':id')
  @ApiOperation({ summary: 'Delete a section' })
  remove(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.sectionsService.remove(id, organizationId);
  }

  @Roles('TEACHER', 'ADMIN')
  @Post(':id/enrollments')
  @ApiOperation({ summary: 'Enroll a student in a section' })
  @ApiBody({ type: AddSectionEnrollmentDto })
  addEnrollment(
    @Param('id') id: string,
    @Body() dto: AddSectionEnrollmentDto,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.sectionsService.addEnrollment(
      id,
      dto.studentId,
      organizationId,
    );
  }

  @Roles('TEACHER', 'ADMIN')
  @Delete(':sectionId/enrollments/:studentId')
  @ApiOperation({ summary: 'Remove a student from a section' })
  removeEnrollment(
    @Param('sectionId') sectionId: string,
    @Param('studentId') studentId: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.sectionsService.removeEnrollment(
      sectionId,
      studentId,
      organizationId,
    );
  }
}
