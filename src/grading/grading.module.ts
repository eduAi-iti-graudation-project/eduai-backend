import { Module } from '@nestjs/common';
import { GradingService } from './grading.service';
import { GradingController } from './grading.controller';
import { RubricsModule } from '../rubrics/rubrics.module';
import { AnalysisModule } from '../analysis/analysis.module';

@Module({
  imports: [RubricsModule, AnalysisModule],
  providers: [GradingService],
  controllers: [GradingController],
})
export class GradingModule {}
