import { describe, expect, it } from 'vitest';
import { MEMBERSHIP_EVENTS, MEMBERSHIP_STATUSES, isLive, transition, type MembershipEvent, type MembershipStatus } from './state-machine.js';

/** The table from SPEC.md, cell for cell. `null` is an invalid transition. */
const EXPECTED: Record<MembershipStatus, Record<MembershipEvent, MembershipStatus | null>> = {
  TRIAL: { CHARGE_SUCCEEDED: 'ACTIVE', CHARGE_FAILED: 'PAST_DUE', GRACE_EXPIRED: null, CANCEL: 'CANCELLED' },
  ACTIVE: { CHARGE_SUCCEEDED: 'ACTIVE', CHARGE_FAILED: 'PAST_DUE', GRACE_EXPIRED: null, CANCEL: 'CANCELLED' },
  PAST_DUE: { CHARGE_SUCCEEDED: 'ACTIVE', CHARGE_FAILED: 'PAST_DUE', GRACE_EXPIRED: 'CANCELLED', CANCEL: 'CANCELLED' },
  CANCELLED: { CHARGE_SUCCEEDED: null, CHARGE_FAILED: null, GRACE_EXPIRED: null, CANCEL: null },
};

describe('transition', () => {
  const cells = MEMBERSHIP_STATUSES.flatMap((from) => MEMBERSHIP_EVENTS.map((event) => [from, event, EXPECTED[from][event]] as const));

  it.each(cells)('%s + %s -> %s', (from, event, expected) => {
    const result = transition(from, event);
    if (expected === null) {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.from).toBe(from);
        expect(result.error.event).toBe(event);
        expect(result.error.message).toContain(event);
      }
    } else {
      expect(result).toEqual({ ok: true, status: expected });
    }
  });

  it('covers all 16 cells', () => {
    expect(cells).toHaveLength(16);
  });

  it('treats only cancelled as not live', () => {
    expect(MEMBERSHIP_STATUSES.filter((status) => !isLive(status))).toEqual(['CANCELLED']);
  });
});
