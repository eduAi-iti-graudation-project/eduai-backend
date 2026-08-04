import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { BillingService } from './billing.service';
import {
  ChangePlanDto,
  CreateBillingPortalDto,
  CreateCheckoutSessionDto,
} from './dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { SkipSubscriptionCheck } from '../auth/skip-subscription.decorator';

@ApiTags('billing')
@SkipSubscriptionCheck()
@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Roles('ADMIN')
  @Post('checkout')
  @ApiOperation({
    summary: 'Create a Stripe Checkout session for a subscription plan',
  })
  createCheckoutSession(
    @Body() dto: CreateCheckoutSessionDto,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.billingService.createCheckoutSession({
      organizationId,
      planId: dto.planId,
      successUrl: dto.successUrl,
      cancelUrl: dto.cancelUrl,
    });
  }

  @Roles('ADMIN')
  @Post('change-plan')
  @ApiOperation({
    summary: 'Switch the organization plan (prorated immediately)',
  })
  changePlan(
    @Body() dto: ChangePlanDto,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.billingService.changePlan({
      organizationId,
      planId: dto.planId,
      atPeriodEnd: dto.atPeriodEnd,
    });
  }

  @Roles('ADMIN')
  @Post('portal')
  @ApiOperation({
    summary: 'Open the Stripe billing portal for card/plan management',
  })
  createBillingPortal(
    @Body() dto: CreateBillingPortalDto,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.billingService.createBillingPortalSession({
      organizationId,
      returnUrl: dto.returnUrl,
    });
  }
}
