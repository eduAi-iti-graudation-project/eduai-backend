import { Module } from '@nestjs/common';
import { GradingService } from './grading.service';
import { GradingController } from './grading.controller';
import { FeedbackWriterModule } from '../feedback-writer/feedback-writer.module';

@Module({
  imports: [FeedbackWriterModule],
  providers: [GradingService],
  controllers: [GradingController],
  exports: [GradingService],
})
export class GradingModule {}
