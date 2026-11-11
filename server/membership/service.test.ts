import { describe, expect, it } from 'vitest';
import { DAY_MS } from '../clock.js';
import { TransientPaymentError } from '../payments/provider.js';
import { TEST_START, createTestServices } from '../testing.js';

const USER = 'user-1';

function setup() {
  const context = createTestServices();
  return { ...context, memberships: context.services.memberships };
}

describe('MembershipService.start', () => {
  it('starts a first monthly membership as a 30 day trial with no charge', async () => {
    const { memberships, payments } = setup();
    const outcome = await memberships.start(USER, { planId: 'MONTHLY', paymentMethod: 'CARD_OK', idempotencyKey: 'k1' });
    expect(outcome.error).toBeNull();
    const row = memberships.latest(USER);
    expect(row?.status).toBe('TRIAL');
    expect(row?.trialEndsAt).toBe(new Date(TEST_START.getTime() + 30 * DAY_MS).toISOString());
    expect(row?.currentPeriodEnd).toBe(row?.trialEndsAt);
    expect(payments.calls).toBe(0);
    expect(memberships.history(row?.id ?? '').map((entry) => entry.event)).toEqual(['STARTED']);
  });

  it('charges an annual membership once and starts it active for a year', async () => {
    const { memberships, payments } = setup();
    await memberships.start(USER, { planId: 'ANNUAL', paymentMethod: 'CARD_OK', idempotencyKey: 'k1' });
    const row = memberships.latest(USER);
    expect(row?.status).toBe('ACTIVE');
    expect(row?.trialEndsAt).toBeNull();
    expect(row?.currentPeriodEnd).toBe('2027-10-01T12:00:00.000Z');
    expect(payments.succeededCharges()).toEqual([{ customerId: USER, amountCents: 7900, idempotencyKey: `start:${USER}:k1` }]);
  });

  it('creates nothing when the card is declined', async () => {
    const { memberships } = setup();
    const outcome = await memberships.start(USER, { planId: 'ANNUAL', paymentMethod: 'CARD_DECLINES', idempotencyKey: 'k1' });
    expect(outcome.membershipId).toBeNull();
    expect(outcome.error?.code).toBe('PAYMENT_DECLINED');
    expect(memberships.latest(USER)).toBeUndefined();
  });

  it('replays the decline for the same key, and charges a new key with a good card', async () => {
    const { memberships, payments } = setup();
    await memberships.start(USER, { planId: 'ANNUAL', paymentMethod: 'CARD_DECLINES', idempotencyKey: 'k1' });
    const replay = await memberships.start(USER, { planId: 'ANNUAL', paymentMethod: 'CARD_DECLINES', idempotencyKey: 'k1' });
    expect(replay.error?.code).toBe('PAYMENT_DECLINED');
    expect(payments.calls).toBe(1);
    const retry = await memberships.start(USER, { planId: 'ANNUAL', paymentMethod: 'CARD_OK', idempotencyKey: 'k2' });
    expect(retry.error).toBeNull();
    expect(payments.succeededCharges()).toHaveLength(1);
  });

  it('charges exactly once when the provider charges and then loses the response', async () => {
    const { memberships, payments, metrics } = setup();
    payments.injectFaults('lost_response');
    const outcome = await memberships.start(USER, { planId: 'ANNUAL', paymentMethod: 'CARD_OK', idempotencyKey: 'k1' });
    expect(outcome.error).toBeNull();
    expect(payments.calls).toBe(2);
    expect(payments.succeededCharges()).toHaveLength(1);
    const charges = await metrics.paymentCharges.get();
    expect(charges.values.map((value) => [value.labels.outcome, value.value])).toEqual(
      expect.arrayContaining([
        ['transient_error', 1],
        ['succeeded', 1],
      ]),
    );
  });

  it('gives up after the retry budget, releases the key, and a later retry charges once', async () => {
    const { memberships, payments } = setup();
    payments.injectFaults('transient', 'transient', 'lost_response');
    await expect(memberships.start(USER, { planId: 'ANNUAL', paymentMethod: 'CARD_OK', idempotencyKey: 'k1' })).rejects.toBeInstanceOf(
      TransientPaymentError,
    );
    expect(memberships.latest(USER)).toBeUndefined();
    // The third attempt did charge before its response was lost. The client retries with the same key.
    const outcome = await memberships.start(USER, { planId: 'ANNUAL', paymentMethod: 'CARD_OK', idempotencyKey: 'k1' });
    expect(outcome.error).toBeNull();
    expect(payments.succeededCharges()).toHaveLength(1);
  });

  it('turns a double submit with one key into one membership and one charge', async () => {
    const { memberships, payments } = setup();
    const input = { planId: 'ANNUAL' as const, paymentMethod: 'CARD_OK' as const, idempotencyKey: 'k1' };
    const [first, second] = await Promise.all([memberships.start(USER, input), memberships.start(USER, input)]);
    expect(second).toEqual(first);
    expect(payments.succeededCharges()).toHaveLength(1);
  });

  it('lets only one of two racing keys join, and charges only that one', async () => {
    const { memberships, payments } = setup();
    const [first, second] = await Promise.all([
      memberships.start(USER, { planId: 'ANNUAL', paymentMethod: 'CARD_OK', idempotencyKey: 'tab-a' }),
      memberships.start(USER, { planId: 'ANNUAL', paymentMethod: 'CARD_OK', idempotencyKey: 'tab-b' }),
    ]);
    expect(first.error).toBeNull();
    expect(second.error?.code).toBe('ALREADY_MEMBER');
    expect(second.membershipId).toBe(first.membershipId);
    expect(payments.succeededCharges()).toHaveLength(1);
  });

  it('reports key reuse with different input as a user error', async () => {
    const { memberships } = setup();
    await memberships.start(USER, { planId: 'MONTHLY', paymentMethod: 'CARD_OK', idempotencyKey: 'k1' });
    const outcome = await memberships.start(USER, { planId: 'ANNUAL', paymentMethod: 'CARD_OK', idempotencyKey: 'k1' });
    expect(outcome.error?.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('charges a rejoining member at signup instead of a second trial', async () => {
    const { memberships, payments } = setup();
    await memberships.start(USER, { planId: 'MONTHLY', paymentMethod: 'CARD_OK', idempotencyKey: 'k1' });
    await memberships.cancel(USER, 'c1');
    expect(memberships.trialEligible(USER)).toBe(false);
    await memberships.start(USER, { planId: 'MONTHLY', paymentMethod: 'CARD_OK', idempotencyKey: 'k2' });
    expect(memberships.latest(USER)?.status).toBe('ACTIVE');
    expect(payments.succeededCharges().map((charge) => charge.amountCents)).toEqual([999]);
  });
});

describe('MembershipService.runBilling', () => {
  async function trialMember() {
    const context = setup();
    await context.memberships.start(USER, { planId: 'MONTHLY', paymentMethod: 'CARD_OK', idempotencyKey: 'start' });
    return context;
  }

  it('ends a trial with a charge and moves it to active for a month', async () => {
    const { memberships, clock } = await trialMember();
    clock.advance(30 * DAY_MS);
    await memberships.runBilling(USER, { paymentMethod: 'CARD_OK', idempotencyKey: 'b1' });
    const row = memberships.latest(USER);
    expect(row?.status).toBe('ACTIVE');
    expect(row?.currentPeriodEnd).toBe('2026-12-01T12:00:00.000Z');
  });

  it('goes past due on a decline, recovers on success and resets the count', async () => {
    const { memberships } = await trialMember();
    await memberships.runBilling(USER, { paymentMethod: 'CARD_DECLINES', idempotencyKey: 'b1' });
    expect(memberships.latest(USER)).toMatchObject({ status: 'PAST_DUE', failedChargeCount: 1 });
    await memberships.runBilling(USER, { paymentMethod: 'CARD_OK', idempotencyKey: 'b2' });
    expect(memberships.latest(USER)).toMatchObject({ status: 'ACTIVE', failedChargeCount: 0, paymentMethod: 'CARD_OK' });
  });

  it('cancels after the third failed charge in a row', async () => {
    const { memberships } = await trialMember();
    for (const key of ['b1', 'b2']) await memberships.runBilling(USER, { paymentMethod: 'CARD_DECLINES', idempotencyKey: key });
    expect(memberships.latest(USER)?.status).toBe('PAST_DUE');
    await memberships.runBilling(USER, { paymentMethod: 'CARD_DECLINES', idempotencyKey: 'b3' });
    const row = memberships.latest(USER);
    expect(row?.status).toBe('CANCELLED');
    expect(row?.cancelledAt).not.toBeNull();
    expect(memberships.history(row?.id ?? '').map((entry) => `${entry.event}:${entry.toStatus}`)).toEqual([
      'STARTED:TRIAL',
      'CHARGE_FAILED:PAST_DUE',
      'CHARGE_FAILED:PAST_DUE',
      'CHARGE_FAILED:PAST_DUE',
      'GRACE_EXPIRED:CANCELLED',
    ]);
  });

  it('replays a billing run for the same key without charging again', async () => {
    const { memberships, payments } = await trialMember();
    await memberships.runBilling(USER, { paymentMethod: 'CARD_OK', idempotencyKey: 'b1' });
    await memberships.runBilling(USER, { paymentMethod: 'CARD_OK', idempotencyKey: 'b1' });
    expect(payments.succeededCharges()).toHaveLength(1);
    expect(memberships.history(memberships.latest(USER)?.id ?? '')).toHaveLength(2);
  });

  it('refuses to bill someone with no live membership', async () => {
    const { memberships } = setup();
    expect((await memberships.runBilling(USER, { paymentMethod: 'CARD_OK', idempotencyKey: 'b1' })).error?.code).toBe('NOT_A_MEMBER');
  });
});

describe('MembershipService.cancel', () => {
  it('cancels a live membership and replays for the same key', async () => {
    const { memberships } = setup();
    await memberships.start(USER, { planId: 'MONTHLY', paymentMethod: 'CARD_OK', idempotencyKey: 'k1' });
    const first = await memberships.cancel(USER, 'c1');
    const replay = await memberships.cancel(USER, 'c1');
    expect(first.error).toBeNull();
    expect(replay).toEqual(first);
    expect(memberships.latest(USER)?.status).toBe('CANCELLED');
    const another = await memberships.cancel(USER, 'c2');
    expect(another.error?.code).toBe('NOT_A_MEMBER');
  });
});
