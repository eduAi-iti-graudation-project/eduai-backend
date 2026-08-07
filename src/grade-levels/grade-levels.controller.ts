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
import { GradeLevelsService } from './grade-levels.service';
import { CreateGradeLevelDto, UpdateGradeLevelDto, GradeLevelDto } from './dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

@ApiTags('grade-levels')
@Controller('grade-levels')
export class GradeLevelsController {
  constructor(private readonly gradeLevelsService: GradeLevelsService) {}

  @Roles('TEACHER', 'ADMIN')
  @Get()
  @ApiOperation({ summary: 'List all grade levels in the organization' })
  @ApiOkResponse({ type: GradeLevelDto, isArray: true })
  findAll(@CurrentUser('organizationId') organizationId: string) {
    return this.gradeLevelsService.findAll(organizationId);
  }

  @Roles('TEACHER', 'ADMIN')
  @Get(':id')
  @ApiOperation({ summary: 'Get a grade level with its sections and courses' })
  @ApiOkResponse({ type: GradeLevelDto })
  findOne(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.gradeLevelsService.findOne(id, organizationId);
  }

  @Roles('ADMIN')
  @Post()
  @ApiOperation({ summary: 'Create a grade level' })
  @ApiBody({ type: CreateGradeLevelDto })
  @ApiOkResponse({ type: GradeLevelDto })
  create(
    @Body() dto: CreateGradeLevelDto,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.gradeLevelsService.create(dto, organizationId);
  }

  @Roles('ADMIN')
  @Patch(':id')
  @ApiOperation({ summary: 'Update a grade level' })
  @ApiBody({ type: UpdateGradeLevelDto })
  @ApiOkResponse({ type: GradeLevelDto })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateGradeLevelDto,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.gradeLevelsService.update(id, dto, organizationId);
  }

  @Roles('ADMIN')
  @Delete(':id')
  @ApiOperation({ summary: 'Delete a grade level' })
  remove(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.gradeLevelsService.remove(id, organizationId);
  }
}
