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

@ApiTags('assignments')
@Controller('assignments')
export class AssignmentsController {
  constructor(private readonly assignmentsService: AssignmentsService) {}

  @Post()
  @ApiOperation({ summary: 'Create an assignment' })
  @ApiBody({ type: CreateAssignmentDto })
  @ApiOkResponse({ type: AssignmentDto })
  create(@Body() dto: CreateAssignmentDto) {
    return this.assignmentsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List assignments, optionally filtered by class' })
  @ApiQuery({ name: 'classId', required: false })
  @ApiOkResponse({ type: AssignmentDto, isArray: true })
  findAll(@Query('classId') classId?: string) {
    return this.assignmentsService.findAll(classId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get assignment by ID' })
  @ApiOkResponse({ type: AssignmentDto })
  findOne(@Param('id') id: string) {
    return this.assignmentsService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an assignment' })
  @ApiBody({ type: UpdateAssignmentDto })
  @ApiOkResponse({ type: AssignmentDto })
  update(@Param('id') id: string, @Body() dto: UpdateAssignmentDto) {
    return this.assignmentsService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an assignment' })
  remove(@Param('id') id: string) {
    return this.assignmentsService.remove(id);
  }
}
