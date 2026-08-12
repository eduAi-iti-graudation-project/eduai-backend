import { Logger, UseGuards } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { User } from '@prisma/client';
import { WsAuthGuard } from '../chat/ws-auth.guard';

interface ClientSocket extends Socket {
  data: { user?: User; [key: string]: unknown };
}

interface MeetingChatMessagePayload {
  id: string;
  meetingId: string;
  userId: string;
  name: string;
  text: string;
  createdAt: string;
}

/**
 * Push channel for in-meeting chat and transcripts. Sending is done over
 * REST (validated + persisted); this gateway only fans messages out to the
 * sockets joined on a meeting room.
 */
@WebSocketGateway({
  namespace: '/meeting',
  cors: true,
})
@UseGuards(WsAuthGuard)
export class MeetingEventsGateway implements OnGatewayInit {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(MeetingEventsGateway.name);

  afterInit() {
    this.logger.log('Meeting namespace ready');
  }

  @SubscribeMessage('meeting:join')
  async join(
    @MessageBody() payload: { meetingId: string },
    @ConnectedSocket() socket: ClientSocket,
  ): Promise<void> {
    await socket.join(this.room(payload.meetingId));
    socket.emit('meeting:joined', { meetingId: payload.meetingId });
  }

  @SubscribeMessage('meeting:leave')
  async leave(
    @MessageBody() payload: { meetingId: string },
    @ConnectedSocket() socket: ClientSocket,
  ): Promise<void> {
    await socket.leave(this.room(payload.meetingId));
  }

  broadcastMessage(message: MeetingChatMessagePayload): void {
    this.server
      .to(this.room(message.meetingId))
      .emit('meeting:message', message);
  }

  broadcastTranscript(
    meetingId: string,
    payload: {
      status: string;
      segments?: { startMs: number; endMs: number; text: string }[];
    },
  ): void {
    this.server.to(this.room(meetingId)).emit('meeting:transcript', payload);
  }

  private room(meetingId: string): string {
    return `meeting:${meetingId}`;
  }
}
