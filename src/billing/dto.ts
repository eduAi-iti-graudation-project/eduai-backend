import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CheckoutSessionSchema = z.object({
  planId: z.enum(['basic', 'pro', 'enterprise']),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

export class CreateCheckoutSessionDto extends createZodDto(
  CheckoutSessionSchema,
) {}

export const ChangePlanSchema = z.object({
  planId: z.enum(['basic', 'pro', 'enterprise']),
  atPeriodEnd: z.boolean().default(false),
});

export class ChangePlanDto extends createZodDto(ChangePlanSchema) {}

export const BillingPortalSchema = z.object({
  returnUrl: z.string().url(),
});

export class CreateBillingPortalDto extends createZodDto(BillingPortalSchema) {}

export type PlanId = z.infer<typeof CheckoutSessionSchema>['planId'];
