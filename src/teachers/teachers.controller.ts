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
  ForbiddenException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBody,
  ApiOkResponse,
  ApiConsumes,
  ApiParam,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { TeachersService } from './teachers.service';
import {
  AddTeacherGradeDto,
  UpdateTeacherProfileDto,
  UpdateTeacherMeDto,
  CreateTeacherDocumentDto,
  CreateSalaryDto,
} from './dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

@ApiTags('teachers')
@Controller('teachers')
export class TeachersController {
  constructor(private readonly teachersService: TeachersService) {}

  @Roles('TEACHER', 'ADMIN')
  @Get('me/profile')
  @ApiOperation({ summary: 'Get own teacher profile (TEACHER self-service)' })
  getMeProfile(
    @CurrentUser('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.teachersService.getMyProfile(id, organizationId);
  }

  @Roles('TEACHER', 'ADMIN')
  @Patch('me/profile')
  @ApiOperation({
    summary: 'Update own teacher profile (no SSN/gender changes)',
  })
  @ApiBody({ type: UpdateTeacherMeDto })
  updateMeProfile(
    @CurrentUser('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
    @Body() dto: UpdateTeacherMeDto,
  ) {
    return this.teachersService.updateMyProfile(id, organizationId, dto);
  }

  @Roles('TEACHER', 'ADMIN')
  @Post('me/avatar')
  @UseInterceptors(
    FileInterceptor('photo', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload own avatar photo' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { photo: { type: 'string', format: 'binary' } },
      required: ['photo'],
    },
  })
  updateMeAvatar(
    @CurrentUser('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
    @UploadedFile() photo: Express.Multer.File | undefined,
  ) {
    return this.teachersService.updateMyAvatar(id, organizationId, photo);
  }

  @Roles('TEACHER', 'ADMIN')
  @Get(':id/grades')
  @ApiOperation({ summary: 'List grades assigned to a teacher' })
  @ApiOkResponse({ description: 'List of grades' })
  getGrades(@Param('id') id: string) {
    return this.teachersService.getGrades(id);
  }

  @Roles('TEACHER', 'ADMIN')
  @Get(':id/grades/:gradeId')
  @ApiOperation({
    summary: 'Get one grade with its sections and courses for a teacher',
  })
  @ApiOkResponse({ description: 'Grade detail scoped to the teacher' })
  getGrade(@Param('id') id: string, @Param('gradeId') gradeId: string) {
    return this.teachersService.getGrade(id, gradeId);
  }

  @Roles('ADMIN')
  @Post(':id/grades')
  @ApiOperation({ summary: 'Assign a grade to a teacher' })
  @ApiBody({ type: AddTeacherGradeDto })
  @ApiOkResponse({ description: 'Grade assigned' })
  addGrade(@Param('id') id: string, @Body() dto: AddTeacherGradeDto) {
    return this.teachersService.addGrade(id, dto.offeringId);
  }

  @Roles('ADMIN')
  @Delete(':teacherId/grades/:gradeId')
  @ApiOperation({ summary: 'Remove a grade from a teacher' })
  @ApiOkResponse({ description: 'Grade removed' })
  removeGrade(
    @Param('teacherId') teacherId: string,
    @Param('gradeId') gradeId: string,
  ) {
    return this.teachersService.removeGrade(teacherId, gradeId);
  }

  @Roles('ADMIN')
  @Get(':id/admin-profile')
  @ApiOperation({ summary: 'Get full admin profile for a teacher' })
  getAdminProfile(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.teachersService.getAdminProfile(id, organizationId);
  }

  @Roles('ADMIN')
  @Patch(':id/profile')
  @ApiOperation({ summary: 'Update teacher profile fields' })
  @ApiBody({ type: UpdateTeacherProfileDto })
  updateProfile(
    @Param('id') id: string,
    @Body() dto: UpdateTeacherProfileDto,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.teachersService.updateProfile(id, organizationId, dto);
  }

  @Roles('ADMIN')
  @Get(':id/ssn')
  @ApiOperation({ summary: 'Reveal a teacher SSN (admin only)' })
  async getSsn(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.teachersService.getSsn(id, organizationId);
  }

  @Roles('ADMIN')
  @Post(':id/avatar')
  @UseInterceptors(
    FileInterceptor('photo', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a teacher avatar photo' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { photo: { type: 'string', format: 'binary' } },
      required: ['photo'],
    },
  })
  updateAvatar(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
    @UploadedFile() photo: Express.Multer.File | undefined,
  ) {
    return this.teachersService.updateAvatar(id, organizationId, photo);
  }

  @Roles('TEACHER', 'ADMIN')
  @Get(':id/classes')
  @ApiOperation({
    summary: 'List classes a teacher is currently teaching (self-service)',
  })
  getClasses(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    if (role === 'TEACHER' && id !== userId) {
      throw new ForbiddenException(
        'You can only view your own teaching classes.',
      );
    }
    return this.teachersService.getClasses(id, organizationId);
  }

  @Roles('ADMIN')
  @Get(':id/history')
  @ApiOperation({ summary: 'List class teaching history for a teacher' })
  getHistory(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.teachersService.getHistory(id, organizationId);
  }

  @Roles('ADMIN')
  @Get(':id/documents')
  @ApiOperation({ summary: 'List uploaded teacher documents' })
  getDocuments(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.teachersService.getDocuments(id, organizationId);
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
  @ApiOperation({ summary: 'Upload a teacher document' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        title: { type: 'string' },
        type: { type: 'string' },
      },
      required: ['file', 'title', 'type'],
    },
  })
  createDocument(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: CreateTeacherDocumentDto,
    @CurrentUser('id') adminId: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.teachersService.createDocument(
      id,
      organizationId,
      adminId,
      file,
      dto,
    );
  }

  @Roles('ADMIN')
  @Get(':id/documents/:documentId/file')
  @ApiOperation({ summary: 'Stream a teacher document file' })
  @ApiParam({ name: 'documentId', type: 'string' })
  async getDocumentFile(
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @CurrentUser('organizationId') organizationId: string,
    @Res() res: Response,
  ) {
    const doc = await this.teachersService.getDocumentFile(
      id,
      documentId,
      organizationId,
    );
    res.setHeader('Content-Type', doc.mimeType ?? 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${doc.fileName}"`);
    res.sendFile(doc.fileUrl, (err) => {
      if (err) {
        res.status(HttpStatus.NOT_FOUND).send({
          error: 'TEACHER_DOCUMENT_NOT_FOUND',
          message: 'File is missing.',
        });
      }
    });
  }

  @Roles('ADMIN')
  @Delete(':id/documents/:documentId')
  @ApiOperation({ summary: 'Delete a teacher document' })
  deleteDocument(
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.teachersService.deleteDocument(id, documentId, organizationId);
  }

  @Roles('ADMIN')
  @Get(':id/salaries')
  @ApiOperation({ summary: 'List salary records for a teacher' })
  getSalaries(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.teachersService.getSalaries(id, organizationId);
  }

  @Roles('ADMIN')
  @Post(':id/salaries')
  @ApiOperation({ summary: 'Create a salary record for a teacher' })
  @ApiBody({ type: CreateSalaryDto })
  createSalary(
    @Param('id') id: string,
    @Body() dto: CreateSalaryDto,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.teachersService.createSalary(id, organizationId, dto);
  }

  @Roles('ADMIN')
  @Patch(':id/salaries/:salaryId')
  @ApiOperation({ summary: 'Update a salary record' })
  @ApiParam({ name: 'salaryId', type: 'string' })
  updateSalary(
    @Param('id') id: string,
    @Param('salaryId') salaryId: string,
    @Body() dto: Partial<CreateSalaryDto>,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.teachersService.updateSalary(id, salaryId, organizationId, dto);
  }

  @Roles('ADMIN')
  @Delete(':id/salaries/:salaryId')
  @ApiOperation({ summary: 'Delete a salary record' })
  deleteSalary(
    @Param('id') id: string,
    @Param('salaryId') salaryId: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.teachersService.deleteSalary(id, salaryId, organizationId);
  }
}
