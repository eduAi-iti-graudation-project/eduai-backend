import {
  Controller,
  Post,
  HttpCode,
  Headers,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { WebhooksService } from './webhooks.service';
import { Public } from '../auth/public.decorator';

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Public()
  @Post('stripe')
  @HttpCode(200)
  @ApiOperation({ summary: 'Stripe webhook endpoint (signature-verified)' })
  handleStripe(
    @Headers('stripe-signature') signature: string | undefined,
    @Req() req: Request & { rawBody?: Buffer },
  ) {
    if (!req.rawBody || req.rawBody.length === 0 || !signature) {
      throw new BadRequestException('Missing webhook payload or signature');
    }
    return this.webhooksService.handleStripeEvent(req.rawBody, signature);
  }
}
