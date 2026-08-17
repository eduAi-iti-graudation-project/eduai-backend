import { Module } from '@nestjs/common';
import { AssistantService } from './assistant.service';
import { AssistantController } from './assistant.controller';
import { MaterialsModule } from '../materials/materials.module';
import { AiChatModule } from '../ai-chat/ai-chat.module';

@Module({
  imports: [MaterialsModule, AiChatModule],
  providers: [AssistantService],
  controllers: [AssistantController],
})
export class AssistantModule {}
