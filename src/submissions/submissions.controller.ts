import { Controller, Get, Post, Param, Body, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';
import { SubmissionsService } from './submissions.service';
import { CreateSubmissionDto, SubmissionDto } from './dto';

@ApiTags('submissions')
@Controller('submissions')
export class SubmissionsController {
  constructor(private readonly submissionsService: SubmissionsService) {}

  @Post()
  @ApiOperation({ summary: 'Submit an assignment (student)' })
  @ApiBody({ type: CreateSubmissionDto })
  @ApiOkResponse({ type: SubmissionDto })
  create(@Body() dto: CreateSubmissionDto) {
    return this.submissionsService.create(dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List submissions, optionally filtered by status and assignment',
  })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'assignmentId', required: false })
  @ApiOkResponse({ type: SubmissionDto, isArray: true })
  findAll(
    @Query('status') status?: string,
    @Query('assignmentId') assignmentId?: string,
  ) {
    return this.submissionsService.findAll(status, assignmentId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get submission with scores' })
  findOne(@Param('id') id: string) {
    return this.submissionsService.findOne(id);
  }
}
