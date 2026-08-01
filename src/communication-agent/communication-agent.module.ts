import { Module } from '@nestjs/common';
import { CommunicationAgentService } from './communication-agent.service';
import { ReportsModule } from '../reports/reports.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { LlmModule } from '../common/llm/llm.module';

@Module({
  imports: [PrismaModule, LlmModule, ReportsModule, NotificationsModule],
  providers: [CommunicationAgentService],
  exports: [CommunicationAgentService],
})
export class CommunicationAgentModule {}
