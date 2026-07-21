import { Module } from '@nestjs/common';
import { AnalysisService } from './analysis.service';
import { ReportsModule } from '../reports/reports.module';

@Module({
  imports: [ReportsModule],
  providers: [AnalysisService],
  exports: [AnalysisService],
})
export class AnalysisModule {}
