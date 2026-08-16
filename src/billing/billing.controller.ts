import { Body, Controller, Get, Post } from '@nestjs/common';
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
import { Public } from '../auth/public.decorator';

@ApiTags('billing')
@SkipSubscriptionCheck()
@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Public()
  @Get('plans')
  @ApiOperation({ summary: 'Public plan catalog (tiers, prices, features)' })
  getPlans() {
    return this.billingService.getPlans();
  }

  @Roles('ADMIN')
  @Get('me')
  @ApiOperation({ summary: "The organization's subscription status and plan" })
  getBillingStatus(@CurrentUser('organizationId') organizationId: string) {
    return this.billingService.getBillingStatus(organizationId);
  }

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
