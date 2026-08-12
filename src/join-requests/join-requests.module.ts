import { Module } from '@nestjs/common';
import { JoinRequestsService } from './join-requests.service';
import {
  JoinRequestsController,
  AdminJoinRequestsController,
} from './join-requests.controller';
import { MailerModule } from '../common/mailer/mailer.module';
import { AuthModule } from '../auth/auth.module';
import { RosterModule } from '../roster/roster.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [MailerModule, AuthModule, RosterModule, NotificationsModule],
  providers: [JoinRequestsService],
  controllers: [JoinRequestsController, AdminJoinRequestsController],
  exports: [JoinRequestsService],
})
export class JoinRequestsModule {}
