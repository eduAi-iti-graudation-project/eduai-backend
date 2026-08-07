import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';
import { AssignmentsService } from './assignments.service';
import { CreateAssignmentDto, UpdateAssignmentDto, AssignmentDto } from './dto';
import { Roles } from '../auth/roles.decorator';

@ApiTags('assignments')
@Controller('assignments')
export class AssignmentsController {
  constructor(private readonly assignmentsService: AssignmentsService) {}

  @Roles('TEACHER')
  @Post()
  @ApiOperation({ summary: 'Create an assignment' })
  @ApiBody({ type: CreateAssignmentDto })
  @ApiOkResponse({ type: AssignmentDto })
  create(@Body() dto: CreateAssignmentDto) {
    return this.assignmentsService.create(dto);
  }

  @Roles('TEACHER', 'STUDENT')
  @Get()
  @ApiOperation({
    summary: 'List assignments, optionally filtered by course offering',
  })
  @ApiQuery({ name: 'courseOfferingId', required: false })
  @ApiOkResponse({ type: AssignmentDto, isArray: true })
  findAll(@Query('courseOfferingId') courseOfferingId?: string) {
    return this.assignmentsService.findAll(courseOfferingId);
  }

  @Roles('TEACHER', 'STUDENT')
  @Get(':id')
  @ApiOperation({ summary: 'Get assignment by ID' })
  @ApiOkResponse({ type: AssignmentDto })
  findOne(@Param('id') id: string) {
    return this.assignmentsService.findOne(id);
  }

  @Roles('TEACHER')
  @Patch(':id')
  @ApiOperation({ summary: 'Update an assignment' })
  @ApiBody({ type: UpdateAssignmentDto })
  @ApiOkResponse({ type: AssignmentDto })
  update(@Param('id') id: string, @Body() dto: UpdateAssignmentDto) {
    return this.assignmentsService.update(id, dto);
  }

  @Roles('TEACHER')
  @Delete(':id')
  @ApiOperation({ summary: 'Delete an assignment' })
  remove(@Param('id') id: string) {
    return this.assignmentsService.remove(id);
  }
}
