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
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBody, ApiConsumes } from '@nestjs/swagger';
import { RubricsService } from './rubrics.service';
import { CreateRubricDto } from './dto';
import { Roles } from '../auth/roles.decorator';

@ApiTags('rubrics')
@Controller('rubrics')
export class RubricsController {
  constructor(private readonly rubricsService: RubricsService) {}

  @Roles('TEACHER', 'ADMIN')
  @Post()
  @ApiOperation({ summary: 'Create a rubric with criteria' })
  @ApiBody({ type: CreateRubricDto })
  create(@Body() dto: CreateRubricDto) {
    return this.rubricsService.create(dto);
  }

  @Roles('TEACHER')
  @Get()
  @ApiOperation({ summary: 'List rubrics, optionally filtered by assignment' })
  findAll(@Query('assignmentId') assignmentId?: string) {
    return this.rubricsService.findAll(assignmentId);
  }

  @Roles('TEACHER')
  @Get(':id')
  @ApiOperation({ summary: 'Get rubric with criteria' })
  findOne(@Param('id') id: string) {
    return this.rubricsService.findOne(id);
  }

  @Roles('TEACHER', 'ADMIN')
  @Patch(':id/confirm')
  @ApiOperation({ summary: 'Confirm a rubric (enables grading against it)' })
  confirm(@Param('id') id: string) {
    return this.rubricsService.confirm(id);
  }

  @Roles('ADMIN')
  @Post('import-pdf')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }),
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
      throw new BadRequestException(
        'File is required. Upload a PDF using the "file" field.',
      );
    }
    return this.rubricsService.importPdf(file.buffer);
  }

  @Roles('TEACHER', 'ADMIN')
  @Post('from-pdf')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }),
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
  ) {
    if (!file) {
      throw new BadRequestException(
        'File is required. Upload a PDF using the "file" field.',
      );
    }
    if (!assignmentId) {
      throw new BadRequestException('assignmentId is required');
    }
    return this.rubricsService.fromPdf(file.buffer, assignmentId);
  }
}
