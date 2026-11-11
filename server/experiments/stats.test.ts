import { describe, expect, it } from 'vitest';
import { Z_95, compareProportions, normalCdf, sampleRatioCheck, twoSidedP, wilsonInterval } from './stats.js';

// Reference values from Python's math.erfc and standard statistical tables.
describe('normal distribution', () => {
  it('matches known values to about 1e-7', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1)).toBeCloseTo(0.8413447460685429, 6);
    expect(normalCdf(-1)).toBeCloseTo(0.15865525393145707, 6);
    expect(twoSidedP(Z_95)).toBeCloseTo(0.05, 6);
    expect(twoSidedP(-Z_95)).toBeCloseTo(0.05, 6);
    expect(twoSidedP(3.290526731491926)).toBeCloseTo(0.001, 6);
  });

  it('stays within [0, 1]', () => {
    expect(twoSidedP(0)).toBeCloseTo(1, 7);
    expect(twoSidedP(40)).toBeGreaterThanOrEqual(0);
    expect(normalCdf(40)).toBeLessThanOrEqual(1);
  });
});

describe('wilsonInterval', () => {
  it('matches the closed form', () => {
    const interval = wilsonInterval(10, 100);
    expect(interval.low).toBeCloseTo(0.0552291370606751, 10);
    expect(interval.high).toBeCloseTo(0.17436566150491345, 10);
  });

  it('stays inside [0, 1] at the edges', () => {
    expect(wilsonInterval(0, 50).low).toBe(0);
    expect(wilsonInterval(0, 50).high).toBeCloseTo(0.07134759913335872, 10);
    expect(wilsonInterval(50, 50).high).toBe(1);
  });

  it('is the whole range with no data', () => {
    expect(wilsonInterval(0, 0)).toEqual({ low: 0, high: 1 });
  });
});

describe('compareProportions', () => {
  it('matches a hand-worked two-proportion z-test', () => {
    // 10% vs 12.5% on 2,000 each: pooled p = 0.1125, z = 2.50196, p = 0.012351.
    const result = compareProportions({ conversions: 200, exposures: 2000 }, { conversions: 250, exposures: 2000 });
    expect(result.absoluteLift).toBeCloseTo(0.025, 12);
    expect(result.relativeLift).toBeCloseTo(0.25, 12);
    expect(result.z).toBeCloseTo(2.501955416802672, 9);
    expect(result.pValue).toBeCloseTo(0.0123509477111914, 6);
    expect(result.interval.low).toBeGreaterThan(0);
    expect(result.interval.high).toBeLessThan(0.05);
  });

  it('is symmetric in sign', () => {
    const up = compareProportions({ conversions: 200, exposures: 2000 }, { conversions: 250, exposures: 2000 });
    const down = compareProportions({ conversions: 250, exposures: 2000 }, { conversions: 200, exposures: 2000 });
    expect(down.z).toBeCloseTo(-up.z, 12);
    expect(down.pValue).toBeCloseTo(up.pValue, 12);
  });

  it('handles empty arms and a zero control rate without dividing by zero', () => {
    expect(compareProportions({ conversions: 0, exposures: 0 }, { conversions: 5, exposures: 10 }).pValue).toBe(1);
    const zero = compareProportions({ conversions: 0, exposures: 100 }, { conversions: 0, exposures: 100 });
    expect(zero.relativeLift).toBeNull();
    expect(zero.pValue).toBe(1);
  });
});

describe('sampleRatioCheck', () => {
  it('passes a perfect split', () => {
    const check = sampleRatioCheck(500, 500, 50, 50);
    expect(check.observedShare).toBe(0.5);
    expect(check.expectedShare).toBe(0.5);
    expect(check.pValue).toBeCloseTo(1, 7);
  });

  it('agrees with the chi-square test on a split that is off by a few percent', () => {
    // 5,000 vs 4,700 against 50/50: chi-square 9.278 on 1 degree of freedom, p = 0.002319.
    const check = sampleRatioCheck(5000, 4700, 50, 50);
    expect(check.observedShare).toBeCloseTo(0.5155, 4);
    expect(check.pValue).toBeCloseTo(0.0023187814543345836, 6);
  });

  it('uses the weights, not an even split', () => {
    expect(sampleRatioCheck(900, 100, 90, 10).pValue).toBeCloseTo(1, 7);
    expect(sampleRatioCheck(500, 500, 90, 10).pValue).toBeLessThan(1e-6);
  });

  it('treats no data as no evidence', () => {
    expect(sampleRatioCheck(0, 0, 1, 1).pValue).toBe(1);
  });
});
