import { Module } from '@nestjs/common';
import { StruggleSignalsController } from './struggle-signals.controller';
import { StruggleSignalsService } from './struggle-signals.service';
import { PrismaModule } from '../prisma/prisma.module';
import { QuizzesModule } from '../quizzes/quizzes.module';
import { HomeworkHelperModule } from '../homework-helper/homework-helper.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    PrismaModule,
    QuizzesModule,
    HomeworkHelperModule,
    NotificationsModule,
  ],
  controllers: [StruggleSignalsController],
  providers: [StruggleSignalsService],
  exports: [StruggleSignalsService],
})
export class StruggleSignalsModule {}
