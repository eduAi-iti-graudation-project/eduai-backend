import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse } from '@nestjs/swagger';
import { AssistantService } from './assistant.service';
import { ChatDto, ChatResponseDto } from './dto';
import { Roles } from '../auth/roles.decorator';
import { RequiresTier } from '../auth/requires-tier.decorator';

@ApiTags('assistant')
@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistantService: AssistantService) {}

  @Roles('TEACHER')
  @RequiresTier('PRO', 'ENTERPRISE')
  @Post('chat')
  @ApiOperation({ summary: 'Send a message to the AI assistant' })
  @ApiOkResponse({ type: ChatResponseDto })
  async chat(@Body() dto: ChatDto): Promise<ChatResponseDto> {
    const result = await this.assistantService.chat(dto);
    return result;
  }
}
