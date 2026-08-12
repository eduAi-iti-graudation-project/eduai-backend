import { Controller, Get, Param, Post } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiConflictResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { StruggleSignalsService } from './struggle-signals.service';
import {
  StruggleSignalsResponseDto,
  SendSignalResponseDto,
  DismissSignalResponseDto,
} from './dto';

@ApiTags('struggle-signals')
@Controller()
export class StruggleSignalsController {
  constructor(private readonly struggleSignals: StruggleSignalsService) {}

  @Get('meetings/:id/struggle-signals')
  @Roles('TEACHER')
  @ApiOperation({
    summary:
      'List post-meeting struggle signals for a meeting: pending class-wide clusters, pending individual signals, and dispatched history.',
  })
  @ApiOkResponse({ type: StruggleSignalsResponseDto })
  @ApiUnauthorizedResponse({ description: 'Not authenticated.' })
  @ApiForbiddenResponse({ description: 'Not the meeting teacher.' })
  @ApiNotFoundResponse({ description: 'Meeting not found.' })
  async getStruggleSignals(
    @Param('id') meetingId: string,
    @CurrentUser() user: User,
  ) {
    return this.struggleSignals.getSignalsForMeeting(user, meetingId);
  }

  @Post('struggle-signals/:id/send')
  @Roles('TEACHER')
  @ApiOperation({
    summary:
      'Send a struggle signal to its student: generates a scoped quiz and a homework-helper explanation. Nothing is dispatched automatically.',
  })
  @ApiOkResponse({ type: SendSignalResponseDto })
  @ApiUnauthorizedResponse({ description: 'Not authenticated.' })
  @ApiForbiddenResponse({ description: 'Not the meeting teacher.' })
  @ApiNotFoundResponse({ description: 'Signal not found.' })
  @ApiConflictResponse({ description: 'Signal is not pending anymore.' })
  async sendSignal(@Param('id') signalId: string, @CurrentUser() user: User) {
    return this.struggleSignals.sendSignal(user, signalId);
  }

  @Post('struggle-signals/:id/dismiss')
  @Roles('TEACHER')
  @ApiOperation({
    summary:
      'Dismiss a pending struggle signal (teacher decided it is a non-issue).',
  })
  @ApiOkResponse({ type: DismissSignalResponseDto })
  @ApiUnauthorizedResponse({ description: 'Not authenticated.' })
  @ApiForbiddenResponse({ description: 'Not the meeting teacher.' })
  @ApiNotFoundResponse({ description: 'Signal not found.' })
  @ApiConflictResponse({ description: 'Signal is not pending anymore.' })
  async dismissSignal(
    @Param('id') signalId: string,
    @CurrentUser() user: User,
  ) {
    return this.struggleSignals.dismissSignal(user, signalId);
  }
}
