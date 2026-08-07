import { Module } from '@nestjs/common';
import { HomeworkHelperController } from './homework-helper.controller';
import { HomeworkHelperService } from './homework-helper.service';
import { HomeworkHelperAgent } from './homework-helper.agent';
import { MaterialsModule } from '../materials/materials.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ChatModule } from '../chat/chat.module';

@Module({
  imports: [MaterialsModule, NotificationsModule, ChatModule],
  controllers: [HomeworkHelperController],
  providers: [HomeworkHelperService, HomeworkHelperAgent],
})
export class HomeworkHelperModule {}
