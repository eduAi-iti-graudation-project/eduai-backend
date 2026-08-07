import { Module } from '@nestjs/common';
import { GradingService } from './grading.service';
import { GradingController } from './grading.controller';
import { GradingAgent } from './grading.agent';
import { FeedbackWriterModule } from '../feedback-writer/feedback-writer.module';
import { CommunicationAgentModule } from '../communication-agent/communication-agent.module';

@Module({
  imports: [FeedbackWriterModule, CommunicationAgentModule],
  providers: [GradingService, GradingAgent],
  controllers: [GradingController],
  exports: [GradingService],
})
export class GradingModule {}
