import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Query,
  Body,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { MaterialsService } from './materials.service';
import { UploadMaterialDto } from './dto';

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
        classId: { type: 'string', format: 'uuid' },
      },
    },
  })
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadMaterialDto,
  ) {
    return this.materialsService.upload(
      dto.title,
      dto.classId,
      file.buffer,
      file.originalname,
    );
  }

  @Get('class/:classId/search')
  @ApiOperation({ summary: 'Search material chunks by semantic similarity' })
  searchChunks(
    @Param('classId') classId: string,
    @Query('q') query: string,
    @Query('topK') topK?: string,
  ) {
    return this.materialsService.searchChunks(
      classId,
      query,
      topK ? parseInt(topK, 10) : 5,
    );
  }

  @Get('class/:classId')
  @ApiOperation({ summary: 'List materials for a class' })
  findByClass(@Param('classId') classId: string) {
    return this.materialsService.findByClass(classId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a material with its chunks' })
  findOne(@Param('id') id: string) {
    return this.materialsService.findOne(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a material' })
  delete(@Param('id') id: string) {
    return this.materialsService.delete(id);
  }
}
