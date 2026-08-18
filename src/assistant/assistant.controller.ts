import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { AssistantService } from './assistant.service';
import { ChatDto, ChatResponseDto } from './dto';
import { AiChatConversationListDto, AiChatMessageDto } from '../ai-chat/dto';
import { Roles } from '../auth/roles.decorator';
import { RequiresTier } from '../auth/requires-tier.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

@ApiTags('assistant')
@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistantService: AssistantService) {}

  @Roles('TEACHER')
  @RequiresTier('PRO', 'ENTERPRISE')
  @Post('chat')
  @ApiOperation({ summary: 'Send a message to the AI assistant' })
  @ApiOkResponse({ type: ChatResponseDto })
  async chat(
    @Body() dto: ChatDto,
    @CurrentUser() user: User,
  ): Promise<ChatResponseDto> {
    return this.assistantService.chat(user, dto);
  }

  @Roles('TEACHER')
  @RequiresTier('PRO', 'ENTERPRISE')
  @Get('chat/conversations')
  @ApiOperation({
    summary: 'List the current teacher assistant conversations (newest first)',
  })
  @ApiOkResponse({ type: AiChatConversationListDto })
  listConversations(@CurrentUser() user: User) {
    return this.assistantService.listConversations(user.id);
  }

  @Roles('TEACHER')
  @RequiresTier('PRO', 'ENTERPRISE')
  @Get('chat/conversations/:conversationId')
  @ApiOperation({
    summary: 'Get the message history of an assistant conversation',
  })
  @ApiOkResponse({ type: AiChatMessageDto, isArray: true })
  getConversation(
    @CurrentUser() user: User,
    @Param('conversationId') conversationId: string,
  ) {
    return this.assistantService.getConversation(user.id, conversationId);
  }

  @Roles('TEACHER')
  @RequiresTier('PRO', 'ENTERPRISE')
  @Delete('chat/conversations/:conversationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an assistant conversation and its history' })
  async deleteConversation(
    @CurrentUser() user: User,
    @Param('conversationId') conversationId: string,
  ): Promise<void> {
    await this.assistantService.deleteConversation(user.id, conversationId);
  }
}
