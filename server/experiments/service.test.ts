import { describe, expect, it } from 'vitest';
import { createTestServices } from '../testing.js';
import { MIN_EXPOSURES_PER_VARIANT } from './service.js';

describe('ExperimentService', () => {
  it('assigns without logging anything', () => {
    const { services, repo } = createTestServices();
    const assignment = services.experiments.assign('user-1', 'landing_hero');
    expect(['control', 'savings_calculator']).toContain(assignment.variant);
    expect(repo.countVariantResults('landing_hero', 'membership_started')).toEqual([]);
  });

  it('keeps only the first exposure, with the server-computed variant', () => {
    const { services, clock, metrics } = createTestServices();
    const first = services.experiments.logExposure('user-1', 'landing_hero');
    clock.advance(1000);
    const again = services.experiments.logExposure('user-1', 'landing_hero');
    expect(first.firstExposure).toBe(true);
    expect(again).toEqual({ assignment: first.assignment, firstExposure: false });
    expect(services.experiments.results('landing_hero').totalExposures).toBe(1);
    return metrics.experimentExposures.get().then((counter) => {
      expect(counter.values.reduce((sum, value) => sum + value.value, 0)).toBe(1);
    });
  });

  it('counts a conversion only if it came at or after the first exposure', async () => {
    const { services, clock } = createTestServices();
    // Converted, then exposed: not caused by the variant, so not counted.
    await services.memberships.start('before', { planId: 'MONTHLY', paymentMethod: 'CARD_OK', idempotencyKey: 'k-before' });
    clock.advance(1000);
    services.experiments.logExposure('before', 'landing_hero');
    // Exposed, then converted: counted.
    services.experiments.logExposure('after', 'landing_hero');
    clock.advance(1000);
    await services.memberships.start('after', { planId: 'MONTHLY', paymentMethod: 'CARD_OK', idempotencyKey: 'k-after' });

    const results = services.experiments.results('landing_hero');
    expect(results.totalExposures).toBe(2);
    expect(results.variants.reduce((sum, variant) => sum + variant.conversions, 0)).toBe(1);
    const converted = results.variants.find((variant) => variant.conversions === 1);
    expect(converted?.key).toBe(services.experiments.assign('after', 'landing_hero').variant);
  });

  it('collects until every variant has enough exposures, then reports a comparison', () => {
    const { services } = createTestServices();
    let i = 0;
    const counts = () => services.experiments.results('landing_hero').variants.map((variant) => variant.exposures);
    while (Math.min(...counts()) < MIN_EXPOSURES_PER_VARIANT) services.experiments.logExposure(`user-${String((i += 1))}`, 'landing_hero');

    const results = services.experiments.results('landing_hero');
    expect(results.status).toBe('READY');
    const [control, treatment] = results.variants;
    expect(control?.isControl).toBe(true);
    expect(control?.comparison).toBeNull();
    expect(treatment?.comparison).toMatchObject({ absoluteLift: 0, pValue: 1, significant: false });
    expect(results.sampleRatio.mismatch).toBe(false);
  });

  it('flags a sample ratio mismatch when one arm loses exposures', () => {
    const { services } = createTestServices();
    for (let i = 0; i < 4000; i += 1) {
      const userId = `user-${String(i)}`;
      const { variant } = services.experiments.assign(userId, 'signup_default_plan');
      // Drop a fifth of one arm, as a broken beacon would.
      if (variant === 'annual_default' && i % 5 === 0) continue;
      services.experiments.logExposure(userId, 'signup_default_plan');
    }
    const { sampleRatio } = services.experiments.results('signup_default_plan');
    expect(sampleRatio.mismatch).toBe(true);
    expect(sampleRatio.pValue).toBeLessThan(0.001);
  });
});
