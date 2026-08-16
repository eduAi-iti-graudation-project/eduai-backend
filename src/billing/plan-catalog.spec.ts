import {
  CORE_FEATURES,
  ENTERPRISE_FEATURES,
  PLANS,
  PRO_FEATURES,
  TRIAL_DAYS,
  featureLabels,
  getPlan,
  planIdFromPrice,
} from './plan-catalog';

describe('plan-catalog', () => {
  const originalPrices = {
    basic: process.env.STRIPE_PRICE_BASIC,
    pro: process.env.STRIPE_PRICE_PRO,
    enterprise: process.env.STRIPE_PRICE_ENTERPRISE,
  };

  afterEach(() => {
    for (const [key, value] of Object.entries(originalPrices)) {
      if (value === undefined) {
        delete process.env[`STRIPE_PRICE_${key.toUpperCase()}`];
      } else {
        process.env[`STRIPE_PRICE_${key.toUpperCase()}`] = value;
      }
    }
  });

  it('exposes the three paid plans with agreed pricing and seats', () => {
    expect(PLANS.map((plan) => plan.id)).toEqual([
      'basic',
      'pro',
      'enterprise',
    ]);
    const byId = Object.fromEntries(PLANS.map((plan) => [plan.id, plan]));
    expect(byId.basic.monthlyPriceCents).toBe(5000);
    expect(byId.pro.monthlyPriceCents).toBe(12000);
    expect(byId.enterprise.monthlyPriceCents).toBe(30000);
    expect(byId.basic.seatLimit).toBe(30);
    expect(byId.pro.seatLimit).toBe(100);
    expect(byId.enterprise.seatLimit).toBe(500);
  });

  it('keeps a strict feature hierarchy per tier', () => {
    expect(PRO_FEATURES).toEqual(expect.arrayContaining(CORE_FEATURES));
    expect(ENTERPRISE_FEATURES).toEqual(expect.arrayContaining(PRO_FEATURES));
    expect(ENTERPRISE_FEATURES).toEqual(
      expect.arrayContaining(['insights', 'support']),
    );
  });

  it('every plan has a name, tier, description, and labeled features', () => {
    for (const plan of PLANS) {
      expect(plan.name).toBeTruthy();
      expect(plan.description).toBeTruthy();
      expect(plan.features.length).toBeGreaterThan(0);
      for (const label of featureLabels(plan.features)) {
        expect(label).toBeTruthy();
      }
    }
  });

  it('TRIAL_DAYS matches the guard and reminder services', () => {
    expect(TRIAL_DAYS).toBe(14);
  });

  it('getPlan resolves known plans and rejects unknown ids', () => {
    expect(getPlan('pro')?.id).toBe('pro');
    expect(getPlan('mystery')).toBeUndefined();
  });

  it('planIdFromPrice maps configured price ids back to plans', () => {
    process.env.STRIPE_PRICE_BASIC = 'price_basic';
    expect(planIdFromPrice('price_basic')).toBe('basic');
    expect(planIdFromPrice('price_unknown')).toBeNull();
  });

  it('planIdFromPrice returns null for plans without a configured price', () => {
    delete process.env.STRIPE_PRICE_PRO;
    expect(planIdFromPrice('')).toBeNull();
  });
});
