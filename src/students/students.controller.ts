import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UploadedFile,
  UseInterceptors,
  Res,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiBody,
  ApiConsumes,
  ApiParam,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { StudentsService } from './students.service';
import {
  GradeDto,
  UpdateStudentDto,
  CreateDocumentDto,
  CreateFeeDto,
} from './dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
@ApiTags('students')
@Controller('students')
export class StudentsController {
  constructor(private readonly studentsService: StudentsService) {}

  @Roles('STUDENT', 'GUARDIAN')
  @Get(':id/grades')
  @ApiOperation({ summary: 'Get confirmed grades for a student' })
  @ApiOkResponse({ type: GradeDto, isArray: true })
  getGrades(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.studentsService.getGrades(id, organizationId);
  }

  @Roles('STUDENT', 'GUARDIAN')
  @Get(':id/grades/:submissionId')
  @ApiOperation({ summary: 'Get confirmed grades for a specific submission' })
  @ApiOkResponse({ type: GradeDto, isArray: true })
  getSubmissionGrades(
    @Param('id') id: string,
    @Param('submissionId') submissionId: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.studentsService.getSubmissionGrades(
      id,
      submissionId,
      organizationId,
    );
  }

  @Roles('STUDENT', 'GUARDIAN')
  @Get(':id/classes')
  @ApiOperation({ summary: 'Get enrolled classes for a student' })
  getClasses(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.studentsService.getClasses(id, organizationId);
  }

  @Roles('ADMIN')
  @Patch(':id')
  @ApiOperation({ summary: 'Update student details' })
  @ApiBody({ type: UpdateStudentDto })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateStudentDto,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.studentsService.update(id, dto, organizationId);
  }

  @Roles('ADMIN')
  @Post(':id/guardian')
  @ApiOperation({ summary: 'Link a guardian to a student' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { guardianId: { type: 'string', format: 'uuid' } },
    },
  })
  linkGuardian(
    @Param('id') id: string,
    @Body('guardianId') guardianId: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.studentsService.linkGuardian(id, guardianId, organizationId);
  }

  @Roles('ADMIN')
  @Get(':id/admin-profile')
  @ApiOperation({ summary: 'Get full admin profile for a student' })
  getAdminProfile(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.studentsService.getAdminProfile(id, organizationId);
  }

  @Roles('ADMIN')
  @Get(':id/quiz-grades')
  @ApiOperation({ summary: 'Get the student quiz grades (completed quizzes)' })
  getQuizGrades(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.studentsService.getQuizGrades(id, organizationId);
  }

  @Roles('ADMIN')
  @Get(':id/history')
  @ApiOperation({
    summary: 'Get year-by-year quiz scores and warnings for a student',
  })
  getHistory(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.studentsService.getHistory(id, organizationId);
  }

  @Roles('ADMIN')
  @Get(':id/documents')
  @ApiOperation({ summary: 'List uploaded student documents' })
  getDocuments(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.studentsService.getDocuments(id, organizationId);
  }

  @Roles('ADMIN')
  @Post(':id/documents')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a student document' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        title: { type: 'string' },
        type: { type: 'string' },
        academicYear: { type: 'string', nullable: true },
      },
      required: ['file', 'title', 'type'],
    },
  })
  createDocument(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: CreateDocumentDto,
    @CurrentUser('id') adminId: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.studentsService.createDocument(
      id,
      organizationId,
      adminId,
      file,
      dto,
    );
  }

  @Roles('ADMIN')
  @Get(':id/documents/:documentId/file')
  @ApiOperation({ summary: 'Stream a student document file' })
  @ApiParam({ name: 'documentId', type: 'string' })
  async getDocumentFile(
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @CurrentUser('organizationId') organizationId: string,
    @Res() res: Response,
  ) {
    const doc = await this.studentsService.getDocumentFile(
      id,
      documentId,
      organizationId,
    );
    res.setHeader('Content-Type', doc.mimeType ?? 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${doc.fileName}"`);
    res.sendFile(doc.fileUrl, (err) => {
      if (err) {
        res
          .status(HttpStatus.NOT_FOUND)
          .send({ error: 'FILE_NOT_FOUND', message: 'File is missing.' });
      }
    });
  }

  @Roles('ADMIN')
  @Delete(':id/documents/:documentId')
  @ApiOperation({ summary: 'Delete a student document' })
  deleteDocument(
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.studentsService.deleteDocument(id, documentId, organizationId);
  }

  @Roles('ADMIN')
  @Get(':id/fees')
  @ApiOperation({ summary: 'List fee payments for a student' })
  getFees(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.studentsService.getFees(id, organizationId);
  }

  @Roles('ADMIN')
  @Post(':id/fees')
  @ApiOperation({ summary: 'Create a fee record for a student' })
  @ApiBody({ type: CreateFeeDto })
  createFee(
    @Param('id') id: string,
    @Body() dto: CreateFeeDto,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.studentsService.createFee(id, organizationId, dto);
  }

  @Roles('ADMIN')
  @Patch(':id/fees/:feeId')
  @ApiOperation({ summary: 'Update a fee record' })
  @ApiParam({ name: 'feeId', type: 'string' })
  updateFee(
    @Param('id') id: string,
    @Param('feeId') feeId: string,
    @Body() dto: Partial<CreateFeeDto>,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.studentsService.updateFee(id, feeId, organizationId, dto);
  }

  @Roles('ADMIN')
  @Delete(':id/fees/:feeId')
  @ApiOperation({ summary: 'Delete a fee record' })
  @ApiParam({ name: 'feeId', type: 'string' })
  deleteFee(
    @Param('id') id: string,
    @Param('feeId') feeId: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.studentsService.deleteFee(id, feeId, organizationId);
  }
}
