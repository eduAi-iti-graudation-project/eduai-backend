import { Module } from '@nestjs/common';
import { GradingService } from './grading.service';
import { GradingController } from './grading.controller';
import { CommunicationAgentModule } from '../communication-agent/communication-agent.module';

@Module({
  imports: [CommunicationAgentModule],
  providers: [GradingService],
  controllers: [GradingController],
  exports: [GradingService],
})
export class GradingModule {}
