import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiBody,
  ApiConsumes,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { StudentsService } from './students.service';
import type { User } from '@prisma/client';
import {
  GradeDto,
  UpdateStudentDto,
  CreateDocumentDto,
  CreateFeeDto,
  LinkGuardianDto,
} from './dto';
import { Roles } from '../auth/roles.decorator';
import { AllowGuardianless } from '../auth/allow-guardianless.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
@ApiTags('students')
@Controller('students')
export class StudentsController {
  constructor(private readonly studentsService: StudentsService) {}

  @Roles('ADMIN')
  @Get()
  @ApiOperation({
    summary: 'List students (optionally only those with no linked guardian)',
  })
  @ApiQuery({
    name: 'withoutGuardian',
    required: false,
    type: String,
    description: 'Set to "true" to list only guardian-less students',
  })
  list(
    @Query('withoutGuardian') withoutGuardian: string | undefined,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.studentsService.listStudents(
      organizationId,
      withoutGuardian === 'true',
    );
  }

  @Roles('ADMIN')
  @Get('unassigned')
  @ApiOperation({
    summary:
      'List students with no grade and/or no section — the post-import follow-up queue',
  })
  listUnassigned(@CurrentUser('organizationId') organizationId: string) {
    return this.studentsService.listUnassignedStudents(organizationId);
  }

  @Roles('STUDENT', 'GUARDIAN')
  @Get(':id/grades')
  @AllowGuardianless()
  @ApiOperation({ summary: 'Get confirmed grades for a student' })
  @ApiOkResponse({ type: GradeDto, isArray: true })
  getGrades(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
    @CurrentUser() user: User,
  ) {
    return this.studentsService.getGrades(id, organizationId, user);
  }

  @Roles('STUDENT', 'GUARDIAN')
  @Get(':id/grades/:submissionId')
  @AllowGuardianless()
  @ApiOperation({ summary: 'Get confirmed grades for a specific submission' })
  @ApiOkResponse({ type: GradeDto, isArray: true })
  getSubmissionGrades(
    @Param('id') id: string,
    @Param('submissionId') submissionId: string,
    @CurrentUser('organizationId') organizationId: string,
    @CurrentUser() user: User,
  ) {
    return this.studentsService.getSubmissionGrades(
      id,
      submissionId,
      organizationId,
      user,
    );
  }

  @Roles('STUDENT', 'GUARDIAN')
  @Get(':id/classes')
  @AllowGuardianless()
  @ApiOperation({ summary: 'Get enrolled classes for a student' })
  getClasses(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
    @CurrentUser() user: User,
  ) {
    return this.studentsService.getClasses(id, organizationId, user);
  }

  @Roles('ADMIN')
  @Post(':id/credentials/reset')
  @ApiOperation({
    summary:
      'Regenerate a school-provisioned student login password (returned once)',
  })
  resetCredentials(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.studentsService.resetCredentials(id, organizationId);
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
  @ApiOperation({
    summary:
      'Link a guardian to a student (existing guardianId, or email + name to create one)',
  })
  @ApiBody({ type: LinkGuardianDto })
  linkGuardian(
    @Param('id') id: string,
    @Body() dto: LinkGuardianDto,
    @CurrentUser('organizationId') organizationId: string,
    @CurrentUser('id') decidedBy: string,
  ) {
    return this.studentsService.linkGuardian(
      id,
      dto,
      organizationId,
      decidedBy,
    );
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
        category: {
          type: 'string',
          enum: [
            'BIRTH_CERTIFICATE',
            'IMMUNIZATION_RECORD',
            'PREVIOUS_TRANSCRIPT',
            'PAYMENT_RECEIPT',
            'ID_DOCUMENT',
            'OTHER',
          ],
        },
        academicYear: { type: 'string', nullable: true },
      },
      required: ['file', 'title'],
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
  @ApiOperation({ summary: 'Get a signed download URL for a student document' })
  @ApiParam({ name: 'documentId', type: 'string' })
  async getDocumentFile(
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.studentsService.getDocumentFile(id, documentId, organizationId);
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
