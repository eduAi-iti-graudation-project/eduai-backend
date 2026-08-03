import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LlmModule } from '../common/llm/llm.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { FeedbackWriterService } from './feedback-writer.service';

@Module({
  imports: [PrismaModule, LlmModule, NotificationsModule],
  providers: [FeedbackWriterService],
  exports: [FeedbackWriterService],
})
export class FeedbackWriterModule {}
