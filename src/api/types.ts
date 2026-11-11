export type PlanId = 'MONTHLY' | 'ANNUAL';
export type MembershipStatus = 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';
export type DemoPaymentMethod = 'CARD_OK' | 'CARD_DECLINES';
export type UserErrorCode = 'PAYMENT_DECLINED' | 'ALREADY_MEMBER' | 'NOT_A_MEMBER' | 'IDEMPOTENCY_KEY_REUSED';

export interface Plan {
  id: PlanId;
  name: string;
  priceCents: number;
  interval: 'MONTH' | 'YEAR';
  trialDays: number;
}

export interface HistoryEntry {
  id: string;
  event: 'STARTED' | 'CHARGE_SUCCEEDED' | 'CHARGE_FAILED' | 'GRACE_EXPIRED' | 'CANCEL';
  fromStatus: MembershipStatus | null;
  toStatus: MembershipStatus;
  at: string;
  detail: string | null;
}

export interface Membership {
  id: string;
  plan: Plan;
  status: MembershipStatus;
  paymentMethod: DemoPaymentMethod;
  startedAt: string;
  trialEndsAt: string | null;
  currentPeriodEnd: string;
  cancelledAt: string | null;
  failedChargeCount: number;
  history: HistoryEntry[];
}

export interface Viewer {
  id: string;
  trialEligible: boolean;
  membership: Membership | null;
}

export interface UserError {
  code: UserErrorCode;
  message: string;
}

export interface MembershipPayload {
  membership: Membership | null;
  error: UserError | null;
}

export interface Interval {
  low: number;
  high: number;
}

export interface VariantResult {
  key: string;
  label: string;
  weight: number;
  isControl: boolean;
  exposures: number;
  conversions: number;
  rate: number;
  interval: Interval;
  comparison: {
    absoluteLift: number;
    interval: Interval;
    relativeLift: number | null;
    pValue: number;
    significant: boolean;
  } | null;
}

export interface Experiment {
  key: string;
  description: string;
  metric: string;
  results: {
    status: 'COLLECTING' | 'READY';
    minExposuresPerVariant: number;
    totalExposures: number;
    variants: VariantResult[];
    sampleRatio: { observedShare: number; expectedShare: number; pValue: number; mismatch: boolean };
  };
}
