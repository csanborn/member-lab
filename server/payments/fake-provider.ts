import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { TransientPaymentError, type ChargeRequest, type ChargeResult, type PaymentProvider } from './provider.js';

/**
 * - `decline`: the card is declined.
 * - `transient`: the call fails before any charge is made.
 * - `lost_response`: the charge is made, then the response is lost on the way back.
 */
export type PaymentFault = 'decline' | 'transient' | 'lost_response';

export interface FakeProviderOptions {
  latencyMs?: number;
  /** Chance of a random `transient` fault on any call. */
  transientRate?: number;
  /** Chance of a random `lost_response` fault on any call. */
  lostResponseRate?: number;
  random?: () => number;
}

interface LedgerEntry {
  request: ChargeRequest;
  result: ChargeResult;
}

/** An in-memory stand-in for a card processor, with the failure modes that matter for retries. */
export class FakePaymentProvider implements PaymentProvider {
  readonly #ledger = new Map<string, LedgerEntry>();
  readonly #queuedFaults: PaymentFault[] = [];
  readonly #options: Required<FakeProviderOptions>;
  #calls = 0;

  constructor(options: FakeProviderOptions = {}) {
    this.#options = {
      latencyMs: options.latencyMs ?? 0,
      transientRate: options.transientRate ?? 0,
      lostResponseRate: options.lostResponseRate ?? 0,
      random: options.random ?? Math.random,
    };
  }

  /** Faults applied to the next calls, in order, before any random ones. */
  injectFaults(...faults: PaymentFault[]): void {
    this.#queuedFaults.push(...faults);
  }

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    this.#calls += 1;
    if (this.#options.latencyMs > 0) await sleep(this.#options.latencyMs);

    const existing = this.#ledger.get(request.idempotencyKey);
    if (existing) {
      if (existing.request.amountCents !== request.amountCents || existing.request.customerId !== request.customerId) {
        throw new Error('Idempotency key reused with a different charge');
      }
      return existing.result;
    }

    const fault = this.#queuedFaults.shift() ?? this.#randomFault();
    if (fault === 'transient') throw new TransientPaymentError('Payment provider timed out before charging');

    const chargeId = `ch_${randomUUID()}`;
    const result: ChargeResult =
      fault === 'decline' || request.paymentMethod === 'CARD_DECLINES'
        ? { status: 'declined', chargeId, declineCode: 'card_declined' }
        : { status: 'succeeded', chargeId, amountCents: request.amountCents };
    this.#ledger.set(request.idempotencyKey, { request, result });

    if (fault === 'lost_response') throw new TransientPaymentError('Connection reset after the charge was made');
    return result;
  }

  /** Money that actually moved, for tests and the simulator to check against. */
  succeededCharges(): { customerId: string; amountCents: number; idempotencyKey: string }[] {
    return [...this.#ledger.values()]
      .filter((entry) => entry.result.status === 'succeeded')
      .map(({ request }) => ({ customerId: request.customerId, amountCents: request.amountCents, idempotencyKey: request.idempotencyKey }));
  }

  get calls(): number {
    return this.#calls;
  }

  #randomFault(): PaymentFault | undefined {
    const roll = this.#options.random();
    if (roll < this.#options.transientRate) return 'transient';
    if (roll < this.#options.transientRate + this.#options.lostResponseRate) return 'lost_response';
    return undefined;
  }
}
