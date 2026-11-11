/** z for a two-sided 95% interval. */
export const Z_95 = 1.959963984540054;

export interface Interval {
  low: number;
  high: number;
}

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** ln Γ(x) by the Lanczos approximation (g = 7), good to about 15 digits. */
export function lnGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  const shifted = x - 1;
  let sum = LANCZOS[0] ?? 1;
  for (let i = 1; i < LANCZOS.length; i += 1) sum += (LANCZOS[i] ?? 0) / (shifted + i);
  const t = shifted + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(sum);
}

const EPSILON = 1e-15;
const MAX_ITERATIONS = 1000;

/** Lower regularized gamma P(a, x) as a power series. Converges fast for x < a + 1. */
function gammaPSeries(a: number, x: number): number {
  let term = 1 / a;
  let sum = term;
  for (let n = 1; n < MAX_ITERATIONS; n += 1) {
    term *= x / (a + n);
    sum += term;
    if (Math.abs(term) < Math.abs(sum) * EPSILON) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
}

/** Upper regularized gamma Q(a, x) as a continued fraction (modified Lentz). Converges fast for x >= a + 1. */
function gammaQContinuedFraction(a: number, x: number): number {
  const tiny = 1e-300;
  let b = x + 1 - a;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < MAX_ITERATIONS; i += 1) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < EPSILON) break;
  }
  return Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
}

/** Q(a, x) = Γ(a, x) / Γ(a). Both the normal and chi-square tails reduce to it. */
export function regularizedGammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  return x < a + 1 ? 1 - gammaPSeries(a, x) : gammaQContinuedFraction(a, x);
}

/** P(|Z| >= |z|) for a standard normal Z. Uses erfc(t) = Q(1/2, t²), which keeps precision in the far tail. */
export function twoSidedNormalP(z: number): number {
  return regularizedGammaQ(0.5, (z * z) / 2);
}

export function normalCdf(z: number): number {
  const tail = twoSidedNormalP(z) / 2;
  return z < 0 ? tail : 1 - tail;
}

/** P(X >= x) for a chi-square variable with `df` degrees of freedom. */
export function chiSquareSurvival(x: number, df: number): number {
  return regularizedGammaQ(df / 2, x / 2);
}

/**
 * Wilson score interval for a binomial proportion. Unlike the textbook Wald interval it stays
 * inside [0, 1] and behaves at rates near zero, which conversion rates often are.
 */
export function wilsonInterval(successes: number, trials: number, z = Z_95): Interval {
  if (trials === 0) return { low: 0, high: 1 };
  const p = successes / trials;
  const z2 = z * z;
  const denominator = 1 + z2 / trials;
  const center = (p + z2 / (2 * trials)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials))) / denominator;
  return { low: Math.max(0, center - half), high: Math.min(1, center + half) };
}

export interface Proportion {
  conversions: number;
  exposures: number;
}

export interface Comparison {
  /** Treatment rate minus control rate. */
  absoluteLift: number;
  /** 95% interval on the absolute lift (unpooled standard error). */
  interval: Interval;
  /** Absolute lift over the control rate. Null when the control rate is zero. */
  relativeLift: number | null;
  z: number;
  /** Two-sided p-value of the pooled two-proportion z-test. */
  pValue: number;
}

/** Two-proportion z-test of treatment against control. */
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
  const unpooledSe = Math.sqrt((p1 * (1 - p1)) / n1 + (p2 * (1 - p2)) / n2);
  return {
    absoluteLift,
    interval: { low: absoluteLift - z * unpooledSe, high: absoluteLift + z * unpooledSe },
    relativeLift,
    z: statistic,
    pValue: pooledSe === 0 ? 1 : twoSidedNormalP(statistic),
  };
}

export interface GoodnessOfFit {
  chiSquare: number;
  degreesOfFreedom: number;
  pValue: number;
}

/** Chi-square goodness of fit of observed counts against expected shares (any positive weights). */
export function chiSquareGoodnessOfFit(observed: readonly number[], weights: readonly number[]): GoodnessOfFit {
  if (observed.length !== weights.length || observed.length < 2) {
    throw new Error('Need at least two groups, with one weight per observed count');
  }
  const total = observed.reduce((sum, count) => sum + count, 0);
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const degreesOfFreedom = observed.length - 1;
  if (total === 0) return { chiSquare: 0, degreesOfFreedom, pValue: 1 };
  const chiSquare = observed.reduce((sum, count, i) => {
    const expected = (total * (weights[i] ?? 0)) / weightTotal;
    return sum + (count - expected) ** 2 / expected;
  }, 0);
  return { chiSquare, degreesOfFreedom, pValue: chiSquareSurvival(chiSquare, degreesOfFreedom) };
}
