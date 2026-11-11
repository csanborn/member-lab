import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { PLANS, type BillingInterval, type PlanId } from '../../shared/plans.js';
import { addDays, type Clock } from '../clock.js';
import type { MembershipHistoryRow, MembershipRow, Repository } from '../db/repository.js';
import { IdempotencyKeyReusedError, IdempotencyStore, KeyedMutex, RequestInProgressError } from '../idempotency.js';
import type { Logger } from '../observability/logger.js';
import type { Metrics } from '../observability/metrics.js';
import {
  TransientPaymentError,
  type ChargeRequest,
  type ChargeResult,
  type DemoPaymentMethod,
  type PaymentProvider,
} from '../payments/provider.js';
import { MAX_FAILED_CHARGES, transition, type MembershipEvent } from './state-machine.js';

export const CONVERSION_METRIC = 'membership_started';

export type UserErrorCode =
  | 'PAYMENT_DECLINED'
  | 'ALREADY_MEMBER'
  | 'NOT_A_MEMBER'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'REQUEST_IN_PROGRESS';

export interface UserError {
  code: UserErrorCode;
  message: string;
}

/**
 * What a membership mutation stores against its idempotency key and replays on a repeat.
 * It names the membership rather than copying it, so a replay shows the membership as it is now.
 */
export interface MembershipOutcome {
  membershipId: string | null;
  error: UserError | null;
}

export interface RetryPolicy {
  attempts: number;
  baseDelayMs: number;
}

export interface MembershipServiceDeps {
  repo: Repository;
  payments: PaymentProvider;
  clock: Clock;
  logger: Logger;
  metrics: Metrics;
  retry?: RetryPolicy;
}

export interface StartInput {
  planId: PlanId;
  paymentMethod: DemoPaymentMethod;
  idempotencyKey: string;
}

export interface BillingInput {
  paymentMethod: DemoPaymentMethod;
  idempotencyKey: string;
}

const DEFAULT_RETRY: RetryPolicy = { attempts: 3, baseDelayMs: 100 };

function addInterval(at: Date, interval: BillingInterval): Date {
  const next = new Date(at);
  if (interval === 'MONTH') next.setUTCMonth(next.getUTCMonth() + 1);
  else next.setUTCFullYear(next.getUTCFullYear() + 1);
  return next;
}

function failure(code: UserErrorCode, message: string, membershipId: string | null = null): MembershipOutcome {
  return { membershipId, error: { code, message } };
}

export class MembershipService {
  readonly #repo: Repository;
  readonly #payments: PaymentProvider;
  readonly #clock: Clock;
  readonly #logger: Logger;
  readonly #metrics: Metrics;
  readonly #retry: RetryPolicy;
  readonly #idempotency: IdempotencyStore;
  /** One process owns the database, so a per-user lock is enough to stop two tabs racing a charge. */
  readonly #locks = new KeyedMutex();

  constructor(deps: MembershipServiceDeps) {
    this.#repo = deps.repo;
    this.#payments = deps.payments;
    this.#clock = deps.clock;
    this.#logger = deps.logger;
    this.#metrics = deps.metrics;
    this.#retry = deps.retry ?? DEFAULT_RETRY;
    this.#idempotency = new IdempotencyStore(deps.repo, deps.clock);
  }

  latest(userId: string): MembershipRow | undefined {
    return this.#repo.findLatestMembership(userId);
  }

  find(membershipId: string): MembershipRow | undefined {
    return this.#repo.findMembership(membershipId);
  }

  history(membershipId: string): MembershipHistoryRow[] {
    return this.#repo.listHistory(membershipId);
  }

  trialEligible(userId: string): boolean {
    return !this.#repo.hasHadTrial(userId);
  }

  start(userId: string, input: StartInput): Promise<MembershipOutcome> {
    const { idempotencyKey, ...request } = input;
    return this.#once('start', userId, idempotencyKey, request, async () => {
      const live = this.#repo.findLiveMembership(userId);
      if (live) return failure('ALREADY_MEMBER', 'You already have a Crate Club membership.', live.id);

      const plan = PLANS[input.planId];
      const withTrial = plan.trialDays > 0 && this.trialEligible(userId);
      if (!withTrial) {
        const charge = await this.#charge({
          customerId: userId,
          amountCents: plan.priceCents,
          paymentMethod: input.paymentMethod,
          description: `Crate Club ${plan.name}`,
          idempotencyKey: `start:${userId}:${idempotencyKey}`,
        });
        if (charge.status === 'declined') {
          return failure('PAYMENT_DECLINED', 'Your card was declined. Choose another payment method and try again.');
        }
      }

      const now = this.#clock.now();
      const trialEndsAt = withTrial ? addDays(now, plan.trialDays) : null;
      const row: MembershipRow = {
        id: randomUUID(),
        userId,
        planId: plan.id,
        status: withTrial ? 'TRIAL' : 'ACTIVE',
        paymentMethod: input.paymentMethod,
        startedAt: now.toISOString(),
        trialEndsAt: trialEndsAt?.toISOString() ?? null,
        currentPeriodEnd: (trialEndsAt ?? addInterval(now, plan.interval)).toISOString(),
        cancelledAt: null,
        failedChargeCount: 0,
        updatedAt: now.toISOString(),
      };
      this.#repo.transaction(() => {
        this.#repo.insertMembership(row);
        this.#record(row, 'STARTED', null, withTrial ? 'No charge until the trial ends' : 'Charged at signup');
        this.#repo.insertConversion({ userId, metric: CONVERSION_METRIC, at: row.startedAt });
      });
      this.#logger.info({ membershipId: row.id, planId: plan.id, status: row.status }, 'membership started');
      return { membershipId: row.id, error: null };
    });
  }

  /** Runs the next charge now: the end of a trial, a renewal or a retry while past due. */
  runBilling(userId: string, input: BillingInput): Promise<MembershipOutcome> {
    const { idempotencyKey, ...request } = input;
    return this.#once('billing', userId, idempotencyKey, request, async () => {
      const row = this.#repo.findLiveMembership(userId);
      if (!row) return failure('NOT_A_MEMBER', 'There is no membership to bill.');

      const plan = PLANS[row.planId];
      const charge = await this.#charge({
        customerId: userId,
        amountCents: plan.priceCents,
        paymentMethod: input.paymentMethod,
        description: `Crate Club ${plan.name} renewal`,
        idempotencyKey: `billing:${row.id}:${idempotencyKey}`,
      });

      const now = this.#clock.now();
      const base: MembershipRow = { ...row, paymentMethod: input.paymentMethod, updatedAt: now.toISOString() };
      this.#repo.transaction(() => {
        if (charge.status === 'succeeded') {
          this.#apply(base, 'CHARGE_SUCCEEDED', {
            failedChargeCount: 0,
            currentPeriodEnd: addInterval(now, plan.interval).toISOString(),
          });
          return;
        }
        const failedChargeCount = row.failedChargeCount + 1;
        const pastDue = this.#apply(base, 'CHARGE_FAILED', { failedChargeCount });
        if (failedChargeCount >= MAX_FAILED_CHARGES) {
          this.#apply(pastDue, 'GRACE_EXPIRED', { cancelledAt: now.toISOString() }, `${failedChargeCount} failed charges`);
        }
      });
      return { membershipId: row.id, error: null };
    });
  }

  cancel(userId: string, idempotencyKey: string): Promise<MembershipOutcome> {
    return this.#once('cancel', userId, idempotencyKey, {}, () => {
      const row = this.#repo.findLiveMembership(userId);
      if (!row) return Promise.resolve(failure('NOT_A_MEMBER', 'There is no active membership to cancel.'));
      const now = this.#clock.now().toISOString();
      this.#repo.transaction(() => this.#apply({ ...row, updatedAt: now }, 'CANCEL', { cancelledAt: now }));
      return Promise.resolve({ membershipId: row.id, error: null });
    });
  }

  /** Per-user lock, then at most once per idempotency key. Key misuse comes back as a user error. */
  async #once(
    operation: string,
    userId: string,
    key: string,
    input: object,
    work: () => Promise<MembershipOutcome>,
  ): Promise<MembershipOutcome> {
    try {
      return await this.#locks.run(userId, () => this.#idempotency.run(`${operation}:${userId}`, key, input, work));
    } catch (error) {
      if (error instanceof IdempotencyKeyReusedError) return failure('IDEMPOTENCY_KEY_REUSED', error.message);
      if (error instanceof RequestInProgressError) return failure('REQUEST_IN_PROGRESS', error.message);
      throw error;
    }
  }

  /** Retries only failures where the provider may not have charged, always with the same provider key. */
  async #charge(request: ChargeRequest): Promise<ChargeResult> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.#retry.attempts; attempt += 1) {
      try {
        const result = await this.#payments.charge(request);
        this.#metrics.paymentCharges.inc({ outcome: result.status });
        this.#logger.info({ chargeId: result.chargeId, outcome: result.status, amountCents: request.amountCents }, 'charge');
        return result;
      } catch (error) {
        if (!(error instanceof TransientPaymentError)) throw error;
        lastError = error;
        this.#metrics.paymentCharges.inc({ outcome: 'transient_error' });
        this.#logger.warn({ attempt, err: error.message }, 'transient payment failure');
        if (attempt < this.#retry.attempts) await sleep(this.#retry.baseDelayMs * 2 ** (attempt - 1));
      }
    }
    throw lastError;
  }

  /** The only place a status changes. Throws on an illegal move, which would be a bug in the caller. */
  #apply(row: MembershipRow, event: MembershipEvent, patch: Partial<MembershipRow>, detail: string | null = null): MembershipRow {
    const result = transition(row.status, event);
    if (!result.ok) throw result.error;
    const next: MembershipRow = { ...row, ...patch, status: result.status };
    this.#repo.updateMembership(next);
    this.#record(next, event, row.status, detail);
    this.#metrics.membershipTransitions.inc({ event, from: row.status, to: next.status });
    this.#logger.info({ membershipId: row.id, event, from: row.status, to: next.status }, 'membership transition');
    return next;
  }

  #record(row: MembershipRow, event: MembershipHistoryRow['event'], from: MembershipRow['status'] | null, detail: string | null): void {
    this.#repo.insertHistory({
      id: randomUUID(),
      membershipId: row.id,
      event,
      fromStatus: from,
      toStatus: row.status,
      at: row.updatedAt,
      detail,
    });
  }
}
