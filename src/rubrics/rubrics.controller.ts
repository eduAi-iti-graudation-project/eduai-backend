import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UploadedFile,
  UseInterceptors,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiTags, ApiOperation, ApiBody, ApiConsumes } from '@nestjs/swagger';
import { RubricsService } from './rubrics.service';
import { CreateRubricDto } from './dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';

@ApiTags('rubrics')
@Controller('rubrics')
export class RubricsController {
  constructor(private readonly rubricsService: RubricsService) {}

  @Roles('TEACHER', 'ADMIN')
  @Post()
  @ApiOperation({ summary: 'Create a rubric with criteria' })
  @ApiBody({ type: CreateRubricDto })
  create(
    @Body() dto: CreateRubricDto,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.rubricsService.create(dto, organizationId);
  }

  @Roles('TEACHER')
  @Get()
  @ApiOperation({ summary: 'List rubrics, optionally filtered by assignment' })
  findAll(
    @Query('assignmentId') assignmentId: string | undefined,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.rubricsService.findAll(assignmentId, organizationId);
  }

  @Roles('TEACHER')
  @Get(':id')
  @ApiOperation({ summary: 'Get rubric with criteria' })
  findOne(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.rubricsService.findOne(id, organizationId);
  }

  @Roles('TEACHER', 'ADMIN')
  @Patch(':id/confirm')
  @ApiOperation({ summary: 'Confirm a rubric (enables grading against it)' })
  confirm(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.rubricsService.confirm(id, organizationId);
  }

  @Roles('TEACHER', 'ADMIN')
  @Post('import-pdf')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a PDF rubric and extract criteria' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  importPdf(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new ApiError(
        ErrorCode.FILE_NO_TEXT,
        HttpStatus.BAD_REQUEST,
        'Please upload a PDF file using the "file" field.',
      );
    }
    return this.rubricsService.importPdf(file.buffer);
  }

  @Roles('TEACHER', 'ADMIN')
  @Post('from-pdf')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload a PDF rubric and create the rubric in one call',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        assignmentId: { type: 'string', format: 'uuid' },
      },
    },
  })
  fromPdf(
    @UploadedFile() file: Express.Multer.File,
    @Body('assignmentId') assignmentId: string,
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
        'Please select an assignment to attach this rubric to.',
      );
    }
    return this.rubricsService.fromPdf(
      file.buffer,
      assignmentId,
      organizationId,
    );
  }
}
