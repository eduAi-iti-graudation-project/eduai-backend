import {
  Controller,
  Post,
  Patch,
  Get,
  Delete,
  Param,
  Query,
  Body,
  UploadedFile,
  UseInterceptors,
  HttpCode,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import {
  ApiTags,
  ApiOperation,
  ApiConsumes,
  ApiBody,
  ApiOkResponse,
} from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { MaterialsService } from './materials.service';
import {
  UploadMaterialDto,
  CreateMaterialChapterDto,
  CreateCourseChapterDto,
  UpdateMaterialChapterDto,
  ChunkSearchResultDto,
  MaterialDto,
  MaterialChapterDto,
  MaterialGroupedDto,
} from './dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

@ApiTags('materials')
@Controller('materials')
export class MaterialsController {
  constructor(private readonly materialsService: MaterialsService) {}

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  @ApiOperation({ summary: 'Upload a material file (PDF or text)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        title: { type: 'string' },
        courseOfferingId: { type: 'string', format: 'uuid' },
      },
    },
  })
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadMaterialDto,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.materialsService.upload(
      dto.title,
      dto.courseOfferingId,
      file.buffer,
      file.originalname,
      organizationId,
      dto.assignmentId,
      dto.chapterId,
    );
  }

  @Roles('TEACHER', 'ADMIN')
  @Post('chapters')
  @ApiOperation({ summary: 'Create a material chapter in a class' })
  createChapter(
    @Body() dto: CreateMaterialChapterDto,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.materialsService.createChapter(
      dto.courseOfferingId,
      dto.title,
      organizationId,
    );
  }

  @Roles('TEACHER', 'STUDENT', 'GUARDIAN', 'ADMIN')
  @Get('chapters/offering/:courseOfferingId')
  @ApiOperation({
    summary: 'List material chapters with their materials, plus ungrouped ones',
  })
  findByOfferingGrouped(
    @Param('courseOfferingId') courseOfferingId: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.materialsService.findByOfferingGrouped(
      courseOfferingId,
      organizationId,
    );
  }

  @Roles('TEACHER', 'ADMIN')
  @Patch('chapters/:id')
  @ApiOperation({ summary: 'Rename or reorder a material chapter' })
  updateChapter(
    @Param('id') id: string,
    @Body() dto: UpdateMaterialChapterDto,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.materialsService.updateChapter(id, organizationId, dto);
  }

  @Roles('TEACHER', 'ADMIN')
  @Delete('chapters/:id')
  @ApiOperation({ summary: 'Delete a chapter (materials become ungrouped)' })
  deleteChapter(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.materialsService.deleteChapter(id, organizationId);
  }

  @Roles('TEACHER', 'ADMIN')
  @Post('chapters/:id/materials/:materialId')
  @ApiOperation({ summary: 'Link an existing material to a chapter' })
  moveMaterialToChapter(
    @Param('id') id: string,
    @Param('materialId') materialId: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.materialsService.moveMaterialToChapter(
      materialId,
      id,
      organizationId,
    );
  }

  @Roles('TEACHER', 'ADMIN')
  @HttpCode(200)
  @Delete('chapters/:id/materials/:materialId')
  @ApiOperation({ summary: 'Unlink a material from its chapter' })
  removeMaterialFromChapter(
    @Param('id') _id: string,
    @Param('materialId') materialId: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.materialsService.moveMaterialToChapter(
      materialId,
      null,
      organizationId,
    );
  }

  @Roles('TEACHER', 'STUDENT', 'GUARDIAN', 'ADMIN')
  @Get('assignment/:assignmentId')
  @ApiOperation({ summary: 'List materials linked to an assignment' })
  findByAssignment(
    @Param('assignmentId') assignmentId: string,
    @CurrentUser() user: User,
  ) {
    return this.materialsService.findByAssignment(assignmentId, user);
  }

  @Get('offering/:courseOfferingId/search')
  @ApiOperation({ summary: 'Search material chunks by semantic similarity' })
  searchChunks(
    @Param('courseOfferingId') courseOfferingId: string,
    @Query('q') query: string,
    @Query('topK') topK?: string,
    @Query('chapterId') chapterId?: string,
  ) {
    return this.materialsService.searchChunks(
      courseOfferingId,
      query,
      topK ? parseInt(topK, 10) : 5,
      chapterId,
    );
  }

  @Roles('TEACHER', 'ADMIN')
  @Post('course/:courseId/chapters')
  @ApiOperation({ summary: 'Create a material chapter for a course' })
  @ApiOkResponse({ type: MaterialChapterDto })
  createCourseChapter(
    @Param('courseId') courseId: string,
    @Body() dto: CreateCourseChapterDto,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.materialsService.createCourseChapter(
      courseId,
      dto.title,
      organizationId,
    );
  }

  @Roles('TEACHER', 'STUDENT', 'GUARDIAN', 'ADMIN')
  @Get('course/:courseId/search')
  @ApiOperation({ summary: 'Search material chunks across a course' })
  @ApiOkResponse({ type: ChunkSearchResultDto, isArray: true })
  searchCourseChunks(
    @Param('courseId') courseId: string,
    @Query('q') query: string,
    @Query('topK') topK?: string,
    @Query('chapterId') chapterId?: string,
  ) {
    return this.materialsService.searchChunksByCourse(
      courseId,
      query,
      topK ? parseInt(topK, 10) : 5,
      chapterId,
    );
  }

  @Roles('TEACHER', 'STUDENT', 'GUARDIAN', 'ADMIN')
  @Get('chapters/course/:courseId')
  @ApiOperation({
    summary: 'List material chapters for a course, plus ungrouped materials',
  })
  @ApiOkResponse({ type: MaterialGroupedDto })
  findByCourseGrouped(
    @Param('courseId') courseId: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.materialsService.findByCourseGrouped(courseId, organizationId);
  }

  @Roles('TEACHER', 'STUDENT', 'GUARDIAN', 'ADMIN')
  @Get('course/:courseId')
  @ApiOperation({ summary: 'List materials for a course' })
  @ApiOkResponse({ type: MaterialDto, isArray: true })
  findByCourse(
    @Param('courseId') courseId: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.materialsService.findByCourse(courseId, organizationId);
  }

  @Get('offering/:courseOfferingId')
  @ApiOperation({ summary: 'List materials for a course offering' })
  findByOffering(
    @Param('courseOfferingId') courseOfferingId: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.materialsService.findByOffering(
      courseOfferingId,
      organizationId,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a material with its chunks' })
  findOne(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.materialsService.findOne(id, organizationId);
  }

  @Roles('TEACHER', 'STUDENT', 'GUARDIAN', 'ADMIN')
  @Get(':id/file')
  @ApiOperation({
    summary: 'Get a short-lived signed download URL for a material file',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: { url: { type: 'string' } },
    },
  })
  getFile(@Param('id') id: string, @CurrentUser() user: User) {
    return this.materialsService.getMaterialFileUrl(id, user);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a material' })
  delete(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.materialsService.delete(id, organizationId);
  }
}
