import { Module } from '@nestjs/common';
import { MeetingsController } from './meetings.controller';
import { LivekitWebhookController } from './livekit-webhook.controller';
import { MeetingsService } from './meetings.service';
import { LivekitService } from './livekit.service';
import { TranscriptService } from './transcript.service';
import { MeetingEventsGateway } from './meeting-events.gateway';
import { StruggleSignalsModule } from '../struggle-signals/struggle-signals.module';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { WsAuthGuard } from '../chat/ws-auth.guard';

@Module({
  imports: [AuthModule, PrismaModule, StruggleSignalsModule],
  controllers: [MeetingsController, LivekitWebhookController],
  providers: [
    MeetingsService,
    LivekitService,
    TranscriptService,
    MeetingEventsGateway,
    WsAuthGuard,
  ],
  exports: [MeetingsService],
})
export class MeetingsModule {}
