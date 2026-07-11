import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody } from '@nestjs/swagger';
import { RubricsService } from './rubrics.service';
import { CreateRubricDto } from './dto';

@ApiTags('rubrics')
@Controller('rubrics')
export class RubricsController {
  constructor(private readonly rubricsService: RubricsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a rubric with criteria' })
  @ApiBody({ type: CreateRubricDto })
  create(@Body() dto: CreateRubricDto) {
    return this.rubricsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List rubrics, optionally filtered by assignment' })
  findAll(@Query('assignmentId') assignmentId?: string) {
    return this.rubricsService.findAll(assignmentId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get rubric with criteria' })
  findOne(@Param('id') id: string) {
    return this.rubricsService.findOne(id);
  }

  @Patch(':id/confirm')
  @ApiOperation({ summary: 'Confirm a rubric (enables grading against it)' })
  confirm(@Param('id') id: string) {
    return this.rubricsService.confirm(id);
  }

  @Post('import-pdf')
  @ApiOperation({ summary: 'Upload a PDF rubric and extract criteria' })
  importPdf() {
    return this.rubricsService.importPdf();
  }
}
