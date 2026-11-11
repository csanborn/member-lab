import { describe, expect, it } from 'vitest';
import { createTestServices } from '../testing.js';
import { simulate } from './simulator.js';

async function run(seed: number) {
  const context = createTestServices();
  const summary = await simulate(context.services, context.clock, {
    seed,
    visitors: 3000,
    start: new Date('2026-09-01T00:00:00Z'),
    recruitDays: 14,
    totalDays: 45,
  });
  return { ...context, summary };
}

describe('simulate', () => {
  it('is reproducible for a seed', async () => {
    const [a, b] = await Promise.all([run(7), run(7)]);
    expect(a.summary).toEqual(b.summary);
    expect(a.services.experiments.results('landing_hero')).toEqual(b.services.experiments.results('landing_hero'));
  });

  it('produces believable traffic through the real services', async () => {
    const { summary, services, payments } = await run(11);
    expect(summary.landingExposures).toBeGreaterThan(2500);
    expect(summary.memberships).toBeGreaterThan(100);
    expect(summary.doubleSubmits).toBeGreaterThan(0);
    // Every double submit was absorbed: no idempotency key was charged twice and no user has two live memberships.
    const keys = payments.succeededCharges().map((charge) => charge.idempotencyKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(services.experiments.results('landing_hero').totalExposures).toBe(summary.landingExposures);
  });
});
