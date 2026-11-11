import { describe, expect, it } from 'vitest';
import {
  Z_95,
  chiSquareGoodnessOfFit,
  chiSquareSurvival,
  compareProportions,
  lnGamma,
  normalCdf,
  twoSidedNormalP,
  wilsonInterval,
} from './stats.js';

// Reference values from Python's math.erfc and math.lgamma and standard statistical tables.
describe('special functions', () => {
  it('lnGamma matches factorials', () => {
    expect(lnGamma(1)).toBeCloseTo(0, 12);
    expect(lnGamma(5)).toBeCloseTo(Math.log(24), 12);
    expect(lnGamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 12);
    expect(lnGamma(101)).toBeCloseTo(363.73937555556347, 9);
  });

  it('normal tails', () => {
    expect(twoSidedNormalP(Z_95)).toBeCloseTo(0.05, 12);
    expect(twoSidedNormalP(0)).toBe(1);
    expect(twoSidedNormalP(-Z_95)).toBeCloseTo(0.05, 12);
    expect(normalCdf(0)).toBeCloseTo(0.5, 12);
    expect(normalCdf(1)).toBeCloseTo(0.8413447460685429, 10);
    expect(normalCdf(-1)).toBeCloseTo(1 - 0.8413447460685429, 10);
    // Far tail keeps relative precision instead of rounding to zero.
    expect(twoSidedNormalP(8)).toBeGreaterThan(1e-16);
    expect(twoSidedNormalP(8)).toBeCloseTo(1.244192114854357e-15, 25);
  });

  it('chi-square critical values', () => {
    expect(chiSquareSurvival(3.841458820694124, 1)).toBeCloseTo(0.05, 9);
    expect(chiSquareSurvival(10.827566170662733, 1)).toBeCloseTo(0.001, 9);
    expect(chiSquareSurvival(7.814727903251178, 3)).toBeCloseTo(0.05, 9);
    expect(chiSquareSurvival(0, 2)).toBe(1);
  });
});

describe('wilsonInterval', () => {
  it('matches the closed form', () => {
    const interval = wilsonInterval(10, 100);
    expect(interval.low).toBeCloseTo(0.0552291370606751, 10);
    expect(interval.high).toBeCloseTo(0.17436566150491345, 10);
  });

  it('stays inside [0, 1] at the edges', () => {
    const none = wilsonInterval(0, 50);
    expect(none.low).toBe(0);
    expect(none.high).toBeCloseTo(0.07134759913335872, 10);
    const all = wilsonInterval(50, 50);
    expect(all.high).toBe(1);
    expect(all.low).toBeGreaterThan(0.9);
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
    expect(result.pValue).toBeCloseTo(0.0123509477111914, 9);
    expect(result.interval.low).toBeGreaterThan(0);
    expect(result.interval.high).toBeLessThan(0.05);
  });

  it('is symmetric in sign', () => {
    const up = compareProportions({ conversions: 200, exposures: 2000 }, { conversions: 250, exposures: 2000 });
    const down = compareProportions({ conversions: 250, exposures: 2000 }, { conversions: 200, exposures: 2000 });
    expect(down.z).toBeCloseTo(-up.z, 12);
    expect(down.pValue).toBeCloseTo(up.pValue, 12);
  });

  it('reports no difference for identical arms', () => {
    const result = compareProportions({ conversions: 30, exposures: 300 }, { conversions: 30, exposures: 300 });
    expect(result.z).toBe(0);
    expect(result.pValue).toBeCloseTo(1, 12);
  });

  it('handles empty arms and a zero control rate without dividing by zero', () => {
    expect(compareProportions({ conversions: 0, exposures: 0 }, { conversions: 5, exposures: 10 }).pValue).toBe(1);
    const zeroControl = compareProportions({ conversions: 0, exposures: 100 }, { conversions: 0, exposures: 100 });
    expect(zeroControl.relativeLift).toBeNull();
    expect(zeroControl.pValue).toBe(1);
  });
});

describe('chiSquareGoodnessOfFit', () => {
  it('passes a perfect split', () => {
    expect(chiSquareGoodnessOfFit([500, 500], [50, 50])).toEqual({ chiSquare: 0, degreesOfFreedom: 1, pValue: 1 });
  });

  it('flags a split that is off by a few percent at scale', () => {
    // 5,000 vs 4,700 against 50/50: chi-square = 9.278, p = 0.0023.
    const fit = chiSquareGoodnessOfFit([5000, 4700], [50, 50]);
    expect(fit.chiSquare).toBeCloseTo(9.278350515463918, 9);
    expect(fit.pValue).toBeCloseTo(0.002318, 5);
  });

  it('uses the weights, not an even split', () => {
    expect(chiSquareGoodnessOfFit([900, 100], [90, 10]).pValue).toBeCloseTo(1, 12);
    expect(chiSquareGoodnessOfFit([500, 500], [90, 10]).pValue).toBeLessThan(1e-12);
  });

  it('treats no data as no evidence', () => {
    expect(chiSquareGoodnessOfFit([0, 0], [1, 1]).pValue).toBe(1);
  });

  it('rejects mismatched input', () => {
    expect(() => chiSquareGoodnessOfFit([1], [1])).toThrow();
    expect(() => chiSquareGoodnessOfFit([1, 2], [1])).toThrow();
  });
});
