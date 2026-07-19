import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse } from '@nestjs/swagger';
import { AssistantService } from './assistant.service';
import { ChatDto, ChatResponseDto } from './dto';

@ApiTags('assistant')
@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistantService: AssistantService) {}

  @Post('chat')
  @ApiOperation({ summary: 'Send a message to the AI assistant' })
  @ApiOkResponse({ type: ChatResponseDto })
  async chat(@Body() dto: ChatDto): Promise<ChatResponseDto> {
    const result = await this.assistantService.chat(dto);
    return result;
  }
}
