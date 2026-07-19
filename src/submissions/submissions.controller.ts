import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiBody,
  ApiQuery,
  ApiConsumes,
} from '@nestjs/swagger';
import { SubmissionsService } from './submissions.service';
import { CreateSubmissionDto, SubmissionDto } from './dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

@ApiTags('submissions')
@Controller('submissions')
export class SubmissionsController {
  constructor(private readonly submissionsService: SubmissionsService) {}

  @Roles('STUDENT')
  @Post()
  @ApiOperation({ summary: 'Submit an assignment (student)' })
  @ApiBody({ type: CreateSubmissionDto })
  @ApiOkResponse({ type: SubmissionDto })
  create(
    @Body() dto: CreateSubmissionDto,
    @CurrentUser('id') studentId: string,
  ) {
    return this.submissionsService.create(dto, studentId);
  }

  @Roles('STUDENT')
  @Post('import-pdf')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a submission as PDF' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        assignmentId: { type: 'string', format: 'uuid' },
      },
      required: ['file', 'assignmentId'],
    },
  })
  importPdf(
    @UploadedFile() file: Express.Multer.File,
    @Body('assignmentId') assignmentId: string,
    @CurrentUser('id') studentId: string,
  ) {
    if (!file) {
      throw new BadRequestException(
        'File is required. Upload a PDF using the "file" field.',
      );
    }
    if (!assignmentId) {
      throw new BadRequestException('assignmentId is required');
    }
    return this.submissionsService.createFromPdf(
      file.buffer,
      assignmentId,
      studentId,
    );
  }

  @Roles('TEACHER')
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

  @Roles('TEACHER', 'STUDENT')
  @Get(':id')
  @ApiOperation({ summary: 'Get submission with scores' })
  findOne(@Param('id') id: string) {
    return this.submissionsService.findOne(id);
  }
}
