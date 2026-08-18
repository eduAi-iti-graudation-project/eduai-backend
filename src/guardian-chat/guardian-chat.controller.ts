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
import { GuardianChatService } from './guardian-chat.service';
import { GuardianChatRequestDto, GuardianChatEvent } from './dto';
import { AiChatConversationListDto, AiChatMessageDto } from '../ai-chat/dto';
import { ApiError } from '../common/errors/api-error';
import { Roles } from '../auth/roles.decorator';
import { RequiresTier } from '../auth/requires-tier.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '@prisma/client';

@ApiTags('assistant')
@Controller('assistant')
@RequiresTier('PRO', 'ENTERPRISE')
export class GuardianChatController {
  constructor(private readonly guardianChatService: GuardianChatService) {}

  @Post('guardian-chat')
  @Roles('GUARDIAN')
  @ApiOperation({
    summary:
      'Ask the guardian copilot about a child (SSE: step events then a done event)',
  })
  async chat(
    @Body() dto: GuardianChatRequestDto,
    @CurrentUser() user: User,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const send = (event: GuardianChatEvent) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      await this.guardianChatService.chat(user, dto, send);
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

  @Get('guardian-chat/conversations')
  @Roles('GUARDIAN')
  @ApiOperation({
    summary: 'List the current guardian copilot conversations (newest first)',
  })
  @ApiOkResponse({ type: AiChatConversationListDto })
  listConversations(@CurrentUser() user: User) {
    return this.guardianChatService.listConversations(user.id);
  }

  @Get('guardian-chat/conversations/:conversationId')
  @Roles('GUARDIAN')
  @ApiOperation({
    summary: 'Get the message history of a guardian copilot conversation',
  })
  @ApiOkResponse({ type: AiChatMessageDto, isArray: true })
  getConversation(
    @CurrentUser() user: User,
    @Param('conversationId') conversationId: string,
  ) {
    return this.guardianChatService.getConversation(user.id, conversationId);
  }

  @Delete('guardian-chat/conversations/:conversationId')
  @Roles('GUARDIAN')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a guardian copilot conversation and its history',
  })
  async deleteConversation(
    @CurrentUser() user: User,
    @Param('conversationId') conversationId: string,
  ): Promise<void> {
    await this.guardianChatService.deleteConversation(user.id, conversationId);
  }
}
