import { Module } from '@nestjs/common';
import { AdminChatController } from './admin-chat.controller';
import { AdminChatService } from './admin-chat.service';
import { AdminSupervisor } from './admin-supervisor.agent';
import { DashboardModule } from '../dashboard/dashboard.module';
import { AiChatModule } from '../ai-chat/ai-chat.module';
import { LlmModule } from '../common/llm/llm.module';

@Module({
  imports: [DashboardModule, AiChatModule, LlmModule],
  controllers: [AdminChatController],
  providers: [AdminChatService, AdminSupervisor],
})
export class AdminChatModule {}