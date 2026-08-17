import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  Res,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import { AdminChatService } from './admin-chat.service';
import { AdminChatRequestDto, AdminChatEvent } from './dto';
import { AiChatConversationListDto, AiChatMessageDto } from '../ai-chat/dto';
import { ApiError } from '../common/errors/api-error';
import { Roles } from '../auth/roles.decorator';
import { RequiresTier } from '../auth/requires-tier.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '@prisma/client';

@ApiTags('assistant')
@Controller('assistant')
@RequiresTier('PRO', 'ENTERPRISE')
export class AdminChatController {
  constructor(private readonly adminChatService: AdminChatService) {}

  @Post('admin-chat')
  @Roles('ADMIN')
  @ApiOperation({
    summary:
      'Ask the admin copilot about the school (SSE: step events then a done event)',
  })
  async chat(
    @Body() dto: AdminChatRequestDto,
    @CurrentUser() user: User,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const send = (event: AdminChatEvent) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      await this.adminChatService.chat(user, dto, send);
      res.end();
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : 'Something went wrong. Please try again.';
      send({ type: 'error', message });
      res.end();
    }
  }

  @Get('admin-chat/conversations')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'List the current admin copilot conversations (newest first)',
  })
  @ApiOkResponse({ type: AiChatConversationListDto })
  listConversations(@CurrentUser() user: User) {
    return this.adminChatService.listConversations(user.id);
  }

  @Get('admin-chat/conversations/:conversationId')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Get the message history of an admin copilot conversation',
  })
  @ApiOkResponse({ type: AiChatMessageDto, isArray: true })
  getConversation(
    @CurrentUser() user: User,
    @Param('conversationId') conversationId: string,
  ) {
    return this.adminChatService.getConversation(user.id, conversationId);
  }

  @Delete('admin-chat/conversations/:conversationId')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete an admin copilot conversation and its history',
  })
  async deleteConversation(
    @CurrentUser() user: User,
    @Param('conversationId') conversationId: string,
  ): Promise<void> {
    await this.adminChatService.deleteConversation(user.id, conversationId);
  }
}