import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { HomeworkHelperService } from './homework-helper.service';
import {
  HomeworkHelpRequestDto,
  HomeworkHelpResponseDto,
  HomeworkHelpHistoryResponseDto,
  HomeworkHelpFeedbackDto,
} from './dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '@prisma/client';
import { RequiresTier } from '../auth/requires-tier.decorator';

@ApiTags('assistant')
@Controller('assistant')
@RequiresTier('PRO', 'ENTERPRISE')
export class HomeworkHelperController {
  constructor(private readonly homeworkHelperService: HomeworkHelperService) {}

  @Post('homework-help')
  @Roles('STUDENT')
  @ApiOperation({ summary: 'Ask the homework helper agent for help' })
  @ApiOkResponse({ type: HomeworkHelpResponseDto })
  async help(
    @Body() dto: HomeworkHelpRequestDto,
    @CurrentUser() user: User,
  ): Promise<HomeworkHelpResponseDto> {
    return this.homeworkHelperService.help(user.id, dto);
  }

  @Get('homework-help/history')
  @Roles('STUDENT')
  @ApiOperation({ summary: 'Get past homework help interactions' })
  @ApiQuery({ name: 'classId', required: false })
  @ApiOkResponse({ type: HomeworkHelpHistoryResponseDto })
  async getHistory(
    @CurrentUser() user: User,
    @Query('classId') classId?: string,
  ): Promise<HomeworkHelpHistoryResponseDto> {
    return this.homeworkHelperService.getHistory(user.id, classId);
  }

  @Patch('homework-help/:interactionId/feedback')
  @Roles('STUDENT')
  @ApiOperation({ summary: 'Submit feedback on a homework help interaction' })
  async submitFeedback(
    @Param('interactionId') interactionId: string,
    @Body() dto: HomeworkHelpFeedbackDto,
    @CurrentUser() user: User,
  ): Promise<void> {
    return this.homeworkHelperService.submitFeedback(
      interactionId,
      dto.feedback,
      user.id,
    );
  }
}
