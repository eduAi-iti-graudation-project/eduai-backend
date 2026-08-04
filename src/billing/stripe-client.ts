import Stripe from 'stripe';

export const STRIPE_CLIENT = Symbol('STRIPE_CLIENT');

export function createStripeClient(): Stripe {
  return new Stripe(process.env.STRIPE_SECRET_KEY ?? 'sk_test_not_configured');
}
