import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiQuery,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { HomeworkHelperService } from './homework-helper.service';
import {
  HomeworkHelpRequestDto,
  HomeworkHelpHistoryResponseDto,
  HomeworkHelpFeedbackDto,
  HomeworkHelpEvent,
} from './dto';
import { ApiError } from '../common/errors/api-error';
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
  @ApiOperation({
    summary:
      'Ask the homework helper agent for help (SSE: step events then a done event)',
  })
  async help(
    @Body() dto: HomeworkHelpRequestDto,
    @CurrentUser() user: User,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const send = (event: HomeworkHelpEvent) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      await this.homeworkHelperService.help(user.id, dto, send);
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

  @Get('homework-help/history')
  @Roles('STUDENT')
  @ApiOperation({ summary: 'Get past homework help interactions' })
  @ApiQuery({ name: 'courseOfferingId', required: false })
  @ApiOkResponse({ type: HomeworkHelpHistoryResponseDto })
  async getHistory(
    @CurrentUser() user: User,
    @Query('courseOfferingId') courseOfferingId?: string,
  ): Promise<HomeworkHelpHistoryResponseDto> {
    return this.homeworkHelperService.getHistory(user.id, courseOfferingId);
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
