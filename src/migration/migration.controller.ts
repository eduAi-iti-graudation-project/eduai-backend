import { Body, Controller, Get, Post, Res } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { MigrationService } from './migration.service';
import { AnalyzeCsvDto, AnalyzePastedDto, ImportCsvDto } from './dto';
import { TEMPLATE_CSV } from './csv-template';

@ApiTags('migration')
@Controller('migration')
@Roles('ADMIN')
export class MigrationController {
  constructor(private readonly migrationService: MigrationService) {}

  @Post('csv/analyze')
  @ApiOperation({
    summary: 'Analyze a CSV and propose a column-to-field mapping',
  })
  @ApiBody({ type: AnalyzeCsvDto })
  analyzeCsv(@Body() dto: AnalyzeCsvDto) {
    return this.migrationService.analyzeCsv(dto.csv);
  }

  @Post('csv/analyze-pasted')
  @ApiOperation({
    summary: 'Analyze pasted tab-separated rows and propose a field mapping',
  })
  @ApiBody({ type: AnalyzePastedDto })
  analyzePasted(@Body() dto: AnalyzePastedDto) {
    return this.migrationService.analyzePasted(dto.text);
  }

  @Post('csv/import')
  @ApiOperation({ summary: 'Import students from a confirmed CSV mapping' })
  @ApiBody({ type: ImportCsvDto })
  importCsv(
    @Body() dto: ImportCsvDto,
    @CurrentUser('organizationId') organizationId: string,
    @CurrentUser('id') decidedBy: string,
  ) {
    return this.migrationService.importCsv(
      dto.csv,
      dto.mapping,
      organizationId,
      decidedBy,
    );
  }

  @Get('csv/template')
  @ApiOperation({ summary: 'Download the blank student import template (CSV)' })
  downloadTemplate(@Res() res: Response) {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="eduai-students-template.csv"',
    );
    res.send(TEMPLATE_CSV);
  }
}
