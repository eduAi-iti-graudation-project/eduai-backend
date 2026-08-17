import {
  Controller,
  HttpCode,
  HttpStatus,
  Headers,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { WebhookEvent } from 'livekit-server-sdk';
import { Public } from '../auth/public.decorator';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';
import { MeetingsService } from './meetings.service';
import { LivekitService } from './livekit.service';

@ApiTags('meetings')
@Controller('meetings')
export class LivekitWebhookController {
  constructor(
    private readonly meetingsService: MeetingsService,
    private readonly livekit: LivekitService,
  ) {}

  @Public()
  @Post('webhook/livekit')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'LiveKit webhook endpoint (HMAC-verified): attendance on join/leave, room end, egress finalization, transcript trigger.',
  })
  async handleLivekit(
    @Headers('livekit-signature') signature: string | undefined,
    @Req() req: Request & { rawBody?: Buffer },
  ) {
    if (!req.rawBody || req.rawBody.length === 0 || !signature) {
      throw new ApiError(
        ErrorCode.WEBHOOK_MISSING_PAYLOAD,
        HttpStatus.BAD_REQUEST,
        'Missing webhook payload or signature.',
      );
    }
    let event: WebhookEvent;
    try {
      event = await this.livekit.receiveWebhook(req.rawBody, signature);
    } catch {
      throw new ApiError(
        ErrorCode.WEBHOOK_INVALID_SIGNATURE,
        HttpStatus.UNAUTHORIZED,
        'Invalid LiveKit signature.',
      );
    }
    await this.meetingsService.handleLivekitEvent(event);
    return { received: true };
  }
}
