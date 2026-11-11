export type PlanId = 'MONTHLY' | 'ANNUAL';
export type BillingInterval = 'MONTH' | 'YEAR';

export interface Plan {
  id: PlanId;
  name: string;
  priceCents: number;
  interval: BillingInterval;
  /** Free days before the first charge. Only a user's first membership gets them. */
  trialDays: number;
}

export const PLANS: Readonly<Record<PlanId, Plan>> = {
  MONTHLY: { id: 'MONTHLY', name: 'Monthly', priceCents: 999, interval: 'MONTH', trialDays: 30 },
  ANNUAL: { id: 'ANNUAL', name: 'Annual', priceCents: 7900, interval: 'YEAR', trialDays: 0 },
};

export const PLAN_IDS = Object.keys(PLANS) as PlanId[];
