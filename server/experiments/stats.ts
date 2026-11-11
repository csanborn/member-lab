/**
 * The statistics behind the results page, as small pure functions. Every experiment here has
 * two arms (a control and one treatment), which keeps each test a comparison of two proportions.
 */

/** z for a two-sided 95% interval: 95% of a standard normal lies within ±1.96. */
export const Z_95 = 1.959963984540054;

export interface Interval {
  low: number;
  high: number;
}

/**
 * Standard normal CDF, P(Z <= z). Uses the Abramowitz and Stegun 7.1.26 approximation of the
 * error function, accurate to about 1e-7, which is far finer than any p-value we display.
 */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const polynomial = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - polynomial * Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/** P(|Z| >= |z|): how surprising a z-score this large would be if there were no real difference. */
export function twoSidedP(z: number): number {
  return Math.min(1, 2 * (1 - normalCdf(Math.abs(z))));
}

/**
 * 95% Wilson score interval for a conversion rate. The textbook "p ± 1.96·SE" interval misbehaves
 * at low rates and small samples (it can go below zero). Wilson does not, and conversion rates are
 * usually low.
 */
export function wilsonInterval(successes: number, trials: number, z = Z_95): Interval {
  if (trials === 0) return { low: 0, high: 1 };
  const p = successes / trials;
  const z2 = z * z;
  const denominator = 1 + z2 / trials;
  const center = (p + z2 / (2 * trials)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials))) / denominator;
  return {
    low: successes === 0 ? 0 : Math.max(0, center - half),
    high: successes === trials ? 1 : Math.min(1, center + half),
  };
}

export interface Proportion {
  conversions: number;
  exposures: number;
}

export interface Comparison {
  /** Treatment rate minus control rate, in absolute terms (0.016 is 1.6 points). */
  absoluteLift: number;
  /** 95% interval on the absolute lift. If it excludes zero, so does the test. */
  interval: Interval;
  /** Absolute lift over the control rate (0.18 is 18% better). Null when the control rate is zero. */
  relativeLift: number | null;
  z: number;
  pValue: number;
}

/**
 * Two-proportion z-test. The p-value uses the pooled rate (assume no difference, then ask how
 * unlikely the observed gap is). The interval uses each arm's own rate, which is the honest
 * spread of the lift itself.
 */
export function compareProportions(control: Proportion, treatment: Proportion, z = Z_95): Comparison {
  const n1 = control.exposures;
  const n2 = treatment.exposures;
  const p1 = n1 === 0 ? 0 : control.conversions / n1;
  const p2 = n2 === 0 ? 0 : treatment.conversions / n2;
  const absoluteLift = p2 - p1;
  const relativeLift = p1 === 0 ? null : absoluteLift / p1;
  if (n1 === 0 || n2 === 0) return { absoluteLift, interval: { low: -1, high: 1 }, relativeLift, z: 0, pValue: 1 };

  const pooled = (control.conversions + treatment.conversions) / (n1 + n2);
  const pooledSe = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  const statistic = pooledSe === 0 ? 0 : absoluteLift / pooledSe;
  const se = Math.sqrt((p1 * (1 - p1)) / n1 + (p2 * (1 - p2)) / n2);
  return {
    absoluteLift,
    interval: { low: absoluteLift - z * se, high: absoluteLift + z * se },
    relativeLift,
    z: statistic,
    pValue: pooledSe === 0 ? 1 : twoSidedP(statistic),
  };
}

export interface SampleRatioCheck {
  /** Share of exposures the control actually got. */
  observedShare: number;
  /** Share the control should get from the configured weights. */
  expectedShare: number;
  pValue: number;
}

/**
 * Sample ratio mismatch: did the control get the share of exposures its weight promised? With
 * random bucketing the share lands very close to plan, so a big miss means exposures are being lost
 * or misassigned, and the experiment's comparison cannot be trusted. This is a one-proportion
 * z-test on the control's share (for two arms it equals the usual chi-square test).
 */
export function sampleRatioCheck(controlExposures: number, treatmentExposures: number, controlWeight: number, treatmentWeight: number): SampleRatioCheck {
  const total = controlExposures + treatmentExposures;
  const expectedShare = controlWeight / (controlWeight + treatmentWeight);
  if (total === 0) return { observedShare: expectedShare, expectedShare, pValue: 1 };
  const observedShare = controlExposures / total;
  const se = Math.sqrt((expectedShare * (1 - expectedShare)) / total);
  return { observedShare, expectedShare, pValue: se === 0 ? 1 : twoSidedP((observedShare - expectedShare) / se) };
}
