import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { ChatService } from './chat.service';
import { CreateThreadDto, GetMessagesQueryDto, SendMessageDto } from './dto';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';

@ApiTags('chat')
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get('threads')
  @Roles('TEACHER', 'STUDENT')
  @ApiOperation({ summary: 'List the current user chat threads' })
  listThreads(@CurrentUser() user: User) {
    return this.chatService.listThreads(user);
  }

  @Post('threads')
  @Roles('STUDENT', 'TEACHER')
  @ApiOperation({
    summary:
      'Create or get a chat thread (student with their class teacher, or teacher with a class student)',
  })
  createThread(@CurrentUser() user: User, @Body() dto: CreateThreadDto) {
    return this.chatService.createThreadOrGet(user, dto.classId, dto.studentId);
  }

  @Get('threads/:threadId/messages')
  @Roles('TEACHER', 'STUDENT')
  @ApiOperation({ summary: 'Get chat messages in a thread (cursor paginated)' })
  getMessages(
    @Param('threadId') threadId: string,
    @CurrentUser('id') userId: string,
    @Query() query: GetMessagesQueryDto,
  ) {
    return this.chatService.getMessages(
      threadId,
      userId,
      query.after,
      query.limit,
    );
  }

  @Post('threads/:threadId/messages')
  @Roles('TEACHER', 'STUDENT')
  @ApiOperation({ summary: 'Send a chat message (REST fallback)' })
  sendMessage(
    @Param('threadId') threadId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.chatService.sendMessage(threadId, userId, dto.text);
  }

  @Post('threads/:threadId/read')
  @Roles('TEACHER', 'STUDENT')
  @ApiOperation({ summary: 'Mark counterparty messages in the thread as read' })
  markRead(
    @Param('threadId') threadId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.chatService.markRead(threadId, userId);
  }
}
