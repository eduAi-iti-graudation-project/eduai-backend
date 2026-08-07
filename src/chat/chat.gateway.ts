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
import { WsAuthGuard } from './ws-auth.guard';
import { WsCurrentUser } from './ws-current-user.decorator';
import { ChatService } from './chat.service';

interface ClientSocket extends Socket {
  data: { user?: User; [key: string]: unknown };
}

@WebSocketGateway({
  namespace: '/chat',
  cors: true,
})
@UseGuards(WsAuthGuard)
export class ChatGateway implements OnGatewayInit {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(private readonly chatService: ChatService) {}

  afterInit() {
    this.logger.log('Chat namespace ready');
  }

  @SubscribeMessage('thread:join')
  async join(
    @MessageBody() payload: { threadId: string },
    @WsCurrentUser() user: User,
    @ConnectedSocket() socket: ClientSocket,
  ): Promise<void> {
    const { items } = await this.chatService.getMessages(
      payload.threadId,
      user.id,
      undefined,
      50,
    );
    await socket.join(this.room(payload.threadId));
    socket.emit('thread:joined', { threadId: payload.threadId, items });
  }

  @SubscribeMessage('thread:leave')
  async leave(
    @MessageBody() payload: { threadId: string },
    @ConnectedSocket() socket: ClientSocket,
  ): Promise<void> {
    await socket.leave(this.room(payload.threadId));
  }

  @SubscribeMessage('thread:send')
  async sendMessage(
    @MessageBody() payload: { threadId: string; text: string },
    @WsCurrentUser() user: User,
  ): Promise<void> {
    const message = await this.chatService.sendMessage(
      payload.threadId,
      user.id,
      payload.text,
    );
    this.server.to(this.room(payload.threadId)).emit('thread:message', message);
  }

  private room(threadId: string): string {
    return `thread:${threadId}`;
  }
}
