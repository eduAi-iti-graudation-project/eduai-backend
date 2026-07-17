import { Module } from '@nestjs/common';
import { GradingService } from './grading.service';
import { GradingController } from './grading.controller';
import { RubricsModule } from '../rubrics/rubrics.module';

@Module({
  imports: [RubricsModule],
  providers: [GradingService],
  controllers: [GradingController],
})
export class GradingModule {}
