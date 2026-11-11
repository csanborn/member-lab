import type { PlanId } from '../../shared/plans.js';
import type { MembershipEvent, MembershipStatus } from '../membership/state-machine.js';
import type { DemoPaymentMethod } from '../payments/provider.js';

/** Timestamps are ISO 8601 strings in UTC, which sort the same way as the instants they name. */
export type IsoTime = string;

export interface MembershipRow {
  id: string;
  userId: string;
  planId: PlanId;
  status: MembershipStatus;
  paymentMethod: DemoPaymentMethod;
  startedAt: IsoTime;
  trialEndsAt: IsoTime | null;
  currentPeriodEnd: IsoTime;
  cancelledAt: IsoTime | null;
  /** Failed charges in a row. Reset by a successful charge. */
  failedChargeCount: number;
  updatedAt: IsoTime;
}

export type HistoryEvent = 'STARTED' | MembershipEvent;

export interface MembershipHistoryRow {
  id: string;
  membershipId: string;
  event: HistoryEvent;
  fromStatus: MembershipStatus | null;
  toStatus: MembershipStatus;
  at: IsoTime;
  detail: string | null;
}

export interface ExposureRow {
  experimentKey: string;
  userId: string;
  variant: string;
  firstExposedAt: IsoTime;
}

export interface VariantCounts {
  variant: string;
  exposures: number;
  conversions: number;
}

export interface IdempotencyRow {
  scope: string;
  key: string;
  requestHash: string;
  state: 'pending' | 'complete';
  /** JSON of the stored result, once complete. */
  response: string | null;
  createdAt: IsoTime;
}

/** The only door to storage. Every method is synchronous: one process owns the database. */
export interface Repository {
  ping(): boolean;
  transaction<T>(fn: () => T): T;
  close(): void;

  findLiveMembership(userId: string): MembershipRow | undefined;
  findLatestMembership(userId: string): MembershipRow | undefined;
  findMembership(id: string): MembershipRow | undefined;
  hasHadTrial(userId: string): boolean;
  insertMembership(row: MembershipRow): void;
  updateMembership(row: MembershipRow): void;
  insertHistory(row: MembershipHistoryRow): void;
  listHistory(membershipId: string): MembershipHistoryRow[];

  /** Records the first exposure only. Returns false if this user was already exposed. */
  insertExposure(row: ExposureRow): boolean;
  insertConversion(conversion: { userId: string; metric: string; at: IsoTime }): void;
  /** Exposed users per variant, and how many of them converted at or after their first exposure. */
  countVariantResults(experimentKey: string, metric: string): VariantCounts[];

  findIdempotency(scope: string, key: string): IdempotencyRow | undefined;
  /** Returns false if the key is already claimed. */
  claimIdempotency(row: Omit<IdempotencyRow, 'state' | 'response'>): boolean;
  completeIdempotency(scope: string, key: string, response: string): void;
  releaseIdempotency(scope: string, key: string): void;
}
