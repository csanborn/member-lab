export const MEMBERSHIP_STATUSES = ['TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELLED'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const MEMBERSHIP_EVENTS = ['CHARGE_SUCCEEDED', 'CHARGE_FAILED', 'GRACE_EXPIRED', 'CANCEL'] as const;
export type MembershipEvent = (typeof MEMBERSHIP_EVENTS)[number];

/**
 * Every legal move. A missing entry is an invalid transition. `CANCELLED` is terminal:
 * rejoining creates a new membership instead of reviving the old one.
 */
const TRANSITIONS: Readonly<Record<MembershipStatus, Partial<Record<MembershipEvent, MembershipStatus>>>> = {
  TRIAL: { CHARGE_SUCCEEDED: 'ACTIVE', CHARGE_FAILED: 'PAST_DUE', CANCEL: 'CANCELLED' },
  ACTIVE: { CHARGE_SUCCEEDED: 'ACTIVE', CHARGE_FAILED: 'PAST_DUE', CANCEL: 'CANCELLED' },
  PAST_DUE: { CHARGE_SUCCEEDED: 'ACTIVE', CHARGE_FAILED: 'PAST_DUE', GRACE_EXPIRED: 'CANCELLED', CANCEL: 'CANCELLED' },
  CANCELLED: {},
};

export class InvalidTransitionError extends Error {
  readonly from: MembershipStatus;
  readonly event: MembershipEvent;

  constructor(from: MembershipStatus, event: MembershipEvent) {
    super(`Cannot apply ${event} to a ${from} membership`);
    this.name = 'InvalidTransitionError';
    this.from = from;
    this.event = event;
  }
}

export type TransitionResult =
  | { ok: true; status: MembershipStatus }
  | { ok: false; error: InvalidTransitionError };

export function transition(from: MembershipStatus, event: MembershipEvent): TransitionResult {
  const next = TRANSITIONS[from][event];
  return next ? { ok: true, status: next } : { ok: false, error: new InvalidTransitionError(from, event) };
}

/** A membership that still has, or may regain, its perks. */
export function isLive(status: MembershipStatus): boolean {
  return status !== 'CANCELLED';
}

/** Failed charges in a row, counted while past due, after which the membership is cancelled. */
export const MAX_FAILED_CHARGES = 3;
