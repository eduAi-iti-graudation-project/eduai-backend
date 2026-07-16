import { Controller, Post } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse } from '@nestjs/swagger';
import { AssistantService } from './assistant.service';
import { ChatResponseDto } from './dto';

@ApiTags('assistant')
@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistantService: AssistantService) {}

  @Post('chat')
  @ApiOperation({ summary: 'Send a message to the AI assistant' })
  @ApiOkResponse({ type: ChatResponseDto })
  chat() {
    return this.assistantService.chat();
  }
}
