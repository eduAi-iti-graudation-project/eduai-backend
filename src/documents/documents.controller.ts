import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { DocumentsService } from './documents.service';
import { ConfirmAssignmentDto } from './dto';

@ApiTags('documents')
@Controller('documents')
@Roles('ADMIN')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post('bulk-upload')
  @UseInterceptors(
    FilesInterceptor('files', 50, {
      storage: memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Bulk upload student documents for AI review' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
        },
      },
      required: ['files'],
    },
  })
  bulkUpload(
    @UploadedFiles() files: Express.Multer.File[],
    @CurrentUser('organizationId') organizationId: string,
    @CurrentUser('id') adminId: string,
  ) {
    return this.documentsService.bulkUpload(files, organizationId, adminId);
  }

  @Get('bulk')
  @ApiOperation({ summary: 'List unassigned bulk-uploaded documents' })
  listBulk(@CurrentUser('organizationId') organizationId: string) {
    return this.documentsService.listBulk(organizationId);
  }

  @Patch(':id/confirm-assignment')
  @ApiOperation({ summary: 'Confirm student + category for a document' })
  @ApiParam({ name: 'id', type: 'string' })
  confirmAssignment(
    @Param('id') id: string,
    @Body() dto: ConfirmAssignmentDto,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.documentsService.confirmAssignment(id, organizationId, dto);
  }
}
