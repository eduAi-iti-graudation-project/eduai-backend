import { Module } from '@nestjs/common';
import { GuardianChatController } from './guardian-chat.controller';
import { GuardianChatService } from './guardian-chat.service';
import { GuardianChatAgent } from './guardian-chat.agent';
import { GuardianModule } from '../guardian/guardian.module';
import { AiChatModule } from '../ai-chat/ai-chat.module';

@Module({
  imports: [GuardianModule, AiChatModule],
  controllers: [GuardianChatController],
  providers: [GuardianChatService, GuardianChatAgent],
})
export class GuardianChatModule {}
