import { Module } from '@nestjs/common';
import { SubmissionsService } from './submissions.service';
import { SubmissionsController } from './submissions.controller';
import { GradingModule } from '../grading/grading.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [GradingModule, NotificationsModule],
  providers: [SubmissionsService],
  controllers: [SubmissionsController],
})
export class SubmissionsModule {}
