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

export interface MembershipHistoryRow {
  id: string;
  membershipId: string;
  event: 'STARTED' | MembershipEvent;
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

/** New exposures and conversions per variant per UTC day. Conversions land on the day they happened. */
export interface DailyCounts extends VariantCounts {
  date: string;
}

/** The only door to storage, so swapping the in-memory store for a database touches one file. */
export interface Repository {
  findLiveMembership(userId: string): MembershipRow | undefined;
  findLatestMembership(userId: string): MembershipRow | undefined;
  findMembership(id: string): MembershipRow | undefined;
  hasHadTrial(userId: string): boolean;
  /** Inserts or replaces by id. */
  saveMembership(row: MembershipRow): void;
  addHistory(row: MembershipHistoryRow): void;
  listHistory(membershipId: string): MembershipHistoryRow[];

  /** Records the first exposure only. Returns false if this user was already exposed. */
  addExposure(row: ExposureRow): boolean;
  addConversion(conversion: { userId: string; metric: string; at: IsoTime }): void;
  /** Exposed users per variant, and how many of them converted at or after their first exposure. */
  variantCounts(experimentKey: string, metric: string): VariantCounts[];
  dailyCounts(experimentKey: string, metric: string): DailyCounts[];
}
