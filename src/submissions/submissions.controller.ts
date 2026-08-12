import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UploadedFile,
  UseInterceptors,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
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
import { AllowGuardianless } from '../auth/allow-guardianless.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';

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
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.submissionsService.create(dto, studentId, organizationId);
  }

  @Roles('STUDENT')
  @Post('import-pdf')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
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
    @CurrentUser('organizationId') organizationId: string,
  ) {
    if (!file) {
      throw new ApiError(
        ErrorCode.FILE_NO_TEXT,
        HttpStatus.BAD_REQUEST,
        'Please upload a PDF file using the "file" field.',
      );
    }
    if (!assignmentId) {
      throw new ApiError(
        ErrorCode.ASSIGNMENT_ID_REQUIRED,
        HttpStatus.BAD_REQUEST,
        'Please select an assignment to submit to.',
      );
    }
    return this.submissionsService.createFromPdf(
      file.buffer,
      assignmentId,
      studentId,
      organizationId,
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
    @CurrentUser('organizationId') organizationId?: string,
  ) {
    return this.submissionsService.findAll(
      status,
      assignmentId,
      organizationId!,
    );
  }

  @Roles('STUDENT')
  @Get('mine')
  @AllowGuardianless()
  @ApiOperation({
    summary: "List the current student's own submissions",
  })
  @ApiQuery({ name: 'assignmentId', required: false })
  @ApiOkResponse({ type: SubmissionDto, isArray: true })
  findMine(
    @Query('assignmentId') assignmentId?: string,
    @CurrentUser('id') studentId?: string,
  ) {
    return this.submissionsService.findMine(studentId!, assignmentId);
  }

  @Roles('TEACHER', 'STUDENT')
  @Get(':id')
  @ApiOperation({ summary: 'Get submission with scores' })
  findOne(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.submissionsService.findOne(id, organizationId);
  }
}
