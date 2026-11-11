import type { PlanId } from '../../shared/plans.js';
import { DAY_MS, type ManualClock } from '../clock.js';
import type { DemoPaymentMethod } from '../payments/provider.js';
import type { Services } from '../services.js';
import { seededRandom } from './random.js';

export interface SimulationOptions {
  seed: number;
  visitors: number;
  start: Date;
  /** Days over which new visitors arrive. */
  recruitDays: number;
  /** Days after the start at which the simulation stops, letting trials end and renew. */
  totalDays: number;
}

/**
 * How simulated visitors behave. The landing variant changes who clicks through, and the default
 * plan changes who finishes and which plan they pick. Numbers are invented but in a plausible range.
 */
export const BEHAVIOR = {
  landingRenders: 0.9,
  joinClick: { control: 0.2, savings_calculator: 0.235 } as Record<string, number>,
  completeSignup: { control: 0.46, annual_default: 0.43 } as Record<string, number>,
  choosesAnnual: { control: 0.16, annual_default: 0.41 } as Record<string, number>,
  /** The planted bug: this share of `annual_default` exposures never reach the server. */
  droppedAnnualExposures: 0.12,
  declinedCard: 0.05,
  retryAfterDecline: 0.6,
  doubleSubmit: 0.03,
  cancelsDuringTrial: 0.11,
  renewalDeclined: 0.09,
  recoversAfterDecline: 0.5,
};

export interface SimulationSummary {
  visitors: number;
  landingExposures: number;
  joinExposures: number;
  droppedExposures: number;
  memberships: number;
  declinedSignups: number;
  doubleSubmits: number;
  cancellations: number;
  billingRuns: number;
}

type Event = { at: number; userId: string } & ({ kind: 'visit' } | { kind: 'cancel' } | { kind: 'billing'; attempt: number });

/** A queue ordered by time, so the shared clock only ever moves forward. */
class Timeline {
  readonly #events: Event[] = [];

  push(event: Event): void {
    let low = 0;
    let high = this.#events.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if ((this.#events[mid]?.at ?? 0) <= event.at) low = mid + 1;
      else high = mid;
    }
    this.#events.splice(low, 0, event);
  }

  shift(): Event | undefined {
    return this.#events.shift();
  }
}

/**
 * Plays visitors through the real services with a simulated clock. Exposures, conversions,
 * charges and transitions all take the same code paths as API traffic.
 */
export async function simulate(services: Services, clock: ManualClock, options: SimulationOptions): Promise<SimulationSummary> {
  const random = seededRandom(options.seed);
  const chance = (p: number) => random() < p;
  const startMs = options.start.getTime();
  const endMs = startMs + options.totalDays * DAY_MS;
  const summary: SimulationSummary = {
    visitors: options.visitors,
    landingExposures: 0,
    joinExposures: 0,
    droppedExposures: 0,
    memberships: 0,
    declinedSignups: 0,
    doubleSubmits: 0,
    cancellations: 0,
    billingRuns: 0,
  };
  let keys = 0;
  const nextKey = () => `sim-${String(options.seed)}-${String((keys += 1))}`;

  const timeline = new Timeline();
  for (let i = 0; i < options.visitors; i += 1) {
    timeline.push({ kind: 'visit', userId: `sim-${String(options.seed)}-${String(i)}`, at: startMs + random() * options.recruitDays * DAY_MS });
  }

  async function join(userId: string, planId: PlanId, paymentMethod: DemoPaymentMethod): Promise<boolean> {
    const input = { planId, paymentMethod, idempotencyKey: nextKey() };
    const outcome = chance(BEHAVIOR.doubleSubmit)
      ? await Promise.all([services.memberships.start(userId, input), services.memberships.start(userId, input)]).then(
          ([first]) => {
            summary.doubleSubmits += 1;
            return first;
          },
        )
      : await services.memberships.start(userId, input);
    if (outcome.error?.code === 'PAYMENT_DECLINED') summary.declinedSignups += 1;
    return outcome.error === null;
  }

  async function visit(userId: string): Promise<void> {
    if (!chance(BEHAVIOR.landingRenders)) return;
    const hero = services.experiments.logExposure(userId, 'landing_hero').assignment.variant;
    summary.landingExposures += 1;
    if (!chance(BEHAVIOR.joinClick[hero] ?? 0)) return;

    clock.advance(20_000 + random() * 60_000);
    const defaultPlan = services.experiments.assign(userId, 'signup_default_plan').variant;
    if (defaultPlan === 'annual_default' && chance(BEHAVIOR.droppedAnnualExposures)) summary.droppedExposures += 1;
    else {
      services.experiments.logExposure(userId, 'signup_default_plan');
      summary.joinExposures += 1;
    }
    if (!chance(BEHAVIOR.completeSignup[defaultPlan] ?? 0)) return;

    clock.advance(30_000 + random() * 90_000);
    const planId: PlanId = chance(BEHAVIOR.choosesAnnual[defaultPlan] ?? 0) ? 'ANNUAL' : 'MONTHLY';
    let joined = await join(userId, planId, chance(BEHAVIOR.declinedCard) ? 'CARD_DECLINES' : 'CARD_OK');
    if (!joined && chance(BEHAVIOR.retryAfterDecline)) {
      clock.advance(60_000);
      joined = await join(userId, planId, 'CARD_OK');
    }
    if (!joined) return;
    summary.memberships += 1;

    const membership = services.memberships.latest(userId);
    if (!membership) return;
    const periodEnd = Date.parse(membership.currentPeriodEnd);
    if (membership.status === 'TRIAL' && chance(BEHAVIOR.cancelsDuringTrial)) {
      timeline.push({ kind: 'cancel', userId, at: clock.now().getTime() + random() * (periodEnd - clock.now().getTime()) });
    } else {
      timeline.push({ kind: 'billing', userId, attempt: 1, at: periodEnd });
    }
  }

  async function bill(userId: string, attempt: number): Promise<void> {
    const declines = attempt === 1 ? chance(BEHAVIOR.renewalDeclined) : !chance(BEHAVIOR.recoversAfterDecline);
    await services.memberships.runBilling(userId, { paymentMethod: declines ? 'CARD_DECLINES' : 'CARD_OK', idempotencyKey: nextKey() });
    summary.billingRuns += 1;
    const membership = services.memberships.latest(userId);
    if (membership?.status === 'PAST_DUE') timeline.push({ kind: 'billing', userId, attempt: attempt + 1, at: clock.now().getTime() + 3 * DAY_MS });
  }

  for (let event = timeline.shift(); event && event.at <= endMs; event = timeline.shift()) {
    clock.set(new Date(event.at));
    if (event.kind === 'visit') await visit(event.userId);
    else if (event.kind === 'cancel') {
      const outcome = await services.memberships.cancel(event.userId, nextKey());
      if (!outcome.error) summary.cancellations += 1;
    } else await bill(event.userId, event.attempt);
  }
  return summary;
}
