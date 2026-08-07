import { Body, Controller, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { MigrationService } from './migration.service';
import { AnalyzeCsvDto, ImportCsvDto } from './dto';

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

  @Post('csv/import')
  @ApiOperation({ summary: 'Import students from a confirmed CSV mapping' })
  @ApiBody({ type: ImportCsvDto })
  importCsv(
    @Body() dto: ImportCsvDto,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.migrationService.importCsv(
      dto.csv,
      dto.mapping,
      organizationId,
    );
  }
}
