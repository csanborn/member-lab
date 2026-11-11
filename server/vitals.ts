/** Core Web Vitals and two supporting timings, as reported by the `web-vitals` library. */
export const VITAL_NAMES = ['LCP', 'INP', 'CLS', 'FCP', 'TTFB'] as const;
export type VitalName = (typeof VITAL_NAMES)[number];

/** Google's published "good" and "poor" boundaries. CLS is unitless, the rest are milliseconds. */
export const VITAL_THRESHOLDS: Readonly<Record<VitalName, { good: number; poor: number }>> = {
  LCP: { good: 2500, poor: 4000 },
  INP: { good: 200, poor: 500 },
  CLS: { good: 0.1, poor: 0.25 },
  FCP: { good: 1800, poor: 3000 },
  TTFB: { good: 800, poor: 1800 },
};

export interface VitalSummary {
  name: VitalName;
  p75: number;
  samples: number;
  rating: 'good' | 'needs-improvement' | 'poor';
}

/** Recent samples kept per vital. Old ones drop off, so the summary tracks current builds. */
const MAX_SAMPLES = 1000;

export function isVitalName(name: unknown): name is VitalName {
  return typeof name === 'string' && (VITAL_NAMES as readonly string[]).includes(name);
}

/** The 75th percentile, which is how Google judges a page: three in four visits do at least this well. */
export function percentile75(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.75) - 1)] ?? 0;
}

export function rate(name: VitalName, value: number): VitalSummary['rating'] {
  const { good, poor } = VITAL_THRESHOLDS[name];
  if (value <= good) return 'good';
  return value <= poor ? 'needs-improvement' : 'poor';
}

/** Field data from real page loads, sent by the browser with `navigator.sendBeacon`. */
export class VitalsStore {
  readonly #samples = new Map<VitalName, number[]>();

  record(name: VitalName, value: number): void {
    const samples = this.#samples.get(name) ?? [];
    samples.push(value);
    if (samples.length > MAX_SAMPLES) samples.shift();
    this.#samples.set(name, samples);
  }

  summary(): VitalSummary[] {
    return VITAL_NAMES.flatMap((name) => {
      const samples = this.#samples.get(name) ?? [];
      if (samples.length === 0) return [];
      const p75 = percentile75(samples);
      return [{ name, p75, samples: samples.length, rating: rate(name, p75) }];
    });
  }
}
