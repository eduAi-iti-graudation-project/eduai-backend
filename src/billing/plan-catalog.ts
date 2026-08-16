import { SubscriptionTier } from '@prisma/client';

export type PlanId = 'basic' | 'pro' | 'enterprise';

export const TRIAL_DAYS = 14;

export type PlanFeatureKey =
  | 'ai-grading'
  | 'curriculum-materials'
  | 'attendance'
  | 'alerts'
  | 'assistant'
  | 'quizzes'
  | 'reports'
  | 'labs'
  | 'insights'
  | 'support';

export const PLAN_FEATURES: Record<PlanFeatureKey, string> = {
  'ai-grading': 'AI grading & per-criterion feedback',
  'curriculum-materials': 'Curriculum materials & AI curriculum search',
  attendance: 'Attendance tracking & import',
  alerts: 'Struggle-signal alerts & guardian notifications',
  assistant: 'AI assistant, chat & homework help',
  quizzes: 'AI quiz generation, grading & anti-cheat',
  reports: 'Three-tier automated reports',
  labs: 'Labs & study lab',
  insights: 'Advanced dashboard insights & analytics',
  support: 'Dedicated support & onboarding',
};

export const CORE_FEATURES: PlanFeatureKey[] = [
  'ai-grading',
  'curriculum-materials',
  'attendance',
  'alerts',
];

export const PRO_FEATURES: PlanFeatureKey[] = [
  ...CORE_FEATURES,
  'assistant',
  'quizzes',
  'reports',
  'labs',
];

export const ENTERPRISE_FEATURES: PlanFeatureKey[] = [
  ...PRO_FEATURES,
  'insights',
  'support',
];

export interface PlanDefinition {
  id: PlanId;
  name: string;
  tier: SubscriptionTier;
  monthlyPriceCents: number;
  seatLimit: number;
  description: string;
  features: PlanFeatureKey[];
  getPriceId(): string | undefined;
}

function priceIdEnv(planId: PlanId): string | undefined {
  const key = {
    basic: 'STRIPE_PRICE_BASIC',
    pro: 'STRIPE_PRICE_PRO',
    enterprise: 'STRIPE_PRICE_ENTERPRISE',
  }[planId];
  return process.env[key];
}

export const PLANS: PlanDefinition[] = [
  {
    id: 'basic',
    name: 'Basic',
    tier: SubscriptionTier.BASIC,
    monthlyPriceCents: 5000,
    seatLimit: 30,
    description: 'Core EduAI for small classrooms.',
    features: CORE_FEATURES,
    getPriceId: () => priceIdEnv('basic'),
  },
  {
    id: 'pro',
    name: 'Pro',
    tier: SubscriptionTier.PRO,
    monthlyPriceCents: 12000,
    seatLimit: 100,
    description: 'The full AI suite for growing schools.',
    features: PRO_FEATURES,
    getPriceId: () => priceIdEnv('pro'),
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    tier: SubscriptionTier.ENTERPRISE,
    monthlyPriceCents: 30000,
    seatLimit: 500,
    description:
      'Advanced analytics & priority support for large institutions.',
    features: ENTERPRISE_FEATURES,
    getPriceId: () => priceIdEnv('enterprise'),
  },
];

export function getPlan(id: string | undefined): PlanDefinition | undefined {
  return PLANS.find((plan) => plan.id === id);
}

export function planIdFromPrice(priceId: string): PlanId | null {
  for (const plan of PLANS) {
    if (plan.getPriceId() === priceId) return plan.id;
  }
  return null;
}

export function featureLabels(keys: PlanFeatureKey[]): string[] {
  return keys.map((key) => PLAN_FEATURES[key]);
}
