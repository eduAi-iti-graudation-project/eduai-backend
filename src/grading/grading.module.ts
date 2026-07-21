import { Module } from '@nestjs/common';
import { GradingService } from './grading.service';
import { GradingController } from './grading.controller';
import { AnalysisModule } from '../analysis/analysis.module';

@Module({
  imports: [AnalysisModule],
  providers: [GradingService],
  controllers: [GradingController],
  exports: [GradingService],
})
export class GradingModule {}
