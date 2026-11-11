import { describe, expect, it } from 'vitest';
import { EXPERIMENTS, type ExperimentConfig } from '../../shared/experiments.js';
import { BUCKET_COUNT, assignVariant, bucketFor, hash32 } from './bucketing.js';
import { sampleRatioCheck } from './stats.js';

const users = Array.from({ length: 20_000 }, (_, i) => `user-${String(i)}`);

describe('hash32', () => {
  it('is stable across runs and machines', () => {
    // Pinned so an accidental change to the hash, which would reshuffle every user, fails loudly.
    expect([hash32('a'), hash32('user-1'), hash32('user-2')]).toMatchInlineSnapshot(`
      [
        444641715,
        2005895916,
        853201105,
      ]
    `);
  });

  it('returns unsigned 32-bit integers', () => {
    for (const user of users.slice(0, 1000)) {
      const value = hash32(user);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(2 ** 32);
    }
  });
});

describe('bucketFor', () => {
  const experiment = EXPERIMENTS.landing_hero;

  it('gives the same bucket for the same user every time', () => {
    expect(bucketFor(experiment, 'user-42')).toBe(bucketFor(experiment, 'user-42'));
  });

  it('stays in range', () => {
    for (const user of users) {
      const bucket = bucketFor(experiment, user);
      expect(bucket).toBeGreaterThanOrEqual(0);
      expect(bucket).toBeLessThan(BUCKET_COUNT);
    }
  });

  it('reshuffles users when the salt or the experiment changes', () => {
    const resalted = { ...experiment, salt: 'another-salt' };
    const other = EXPERIMENTS.signup_default_plan;
    const moved = users.slice(0, 1000).filter((user) => bucketFor(experiment, user) !== bucketFor(resalted, user));
    const differs = users.slice(0, 1000).filter((user) => bucketFor(experiment, user) !== bucketFor(other, user));
    expect(moved.length).toBeGreaterThan(990);
    expect(differs.length).toBeGreaterThan(990);
  });
});

describe('assignVariant', () => {
  function split(experiment: ExperimentConfig) {
    const counts = new Map(experiment.variants.map((variant) => [variant.key, 0]));
    for (const user of users) {
      const { key } = assignVariant(experiment, user);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return experiment.variants.map((variant) => counts.get(variant.key) ?? 0);
  }

  it('is deterministic', () => {
    expect(users.slice(0, 100).map((user) => assignVariant(EXPERIMENTS.landing_hero, user).key)).toEqual(
      users.slice(0, 100).map((user) => assignVariant(EXPERIMENTS.landing_hero, user).key),
    );
  });

  it('splits sequential ids 50/50 with no sample ratio mismatch', () => {
    const [control = 0, treatment = 0] = split(EXPERIMENTS.landing_hero);
    expect(sampleRatioCheck(control, treatment, 50, 50).pValue).toBeGreaterThan(0.01);
    expect(Math.abs(control / users.length - 0.5)).toBeLessThan(0.015);
  });

  it('follows uneven weights', () => {
    const experiment: ExperimentConfig = {
      ...EXPERIMENTS.landing_hero,
      variants: [
        { key: 'control', label: 'A', weight: 90 },
        { key: 'b', label: 'B', weight: 10 },
      ],
    };
    const [control = 0, treatment = 0] = split(experiment);
    expect(sampleRatioCheck(control, treatment, 90, 10).pValue).toBeGreaterThan(0.01);
    expect(treatment / users.length).toBeCloseTo(0.1, 1);
  });

  it('puts everyone in a variant with all the weight', () => {
    const experiment: ExperimentConfig = {
      ...EXPERIMENTS.landing_hero,
      variants: [
        { key: 'control', label: 'A', weight: 0 },
        { key: 'b', label: 'B', weight: 1 },
      ],
    };
    expect(new Set(users.slice(0, 500).map((user) => assignVariant(experiment, user).key))).toEqual(new Set(['b']));
  });
});
