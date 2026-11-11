import type { DailyCount } from '../api/types';

export interface TrendPoint {
  date: string;
  exposures: number;
  conversions: number;
  /** Cumulative conversions over cumulative exposures, up to and including this day. */
  rate: number;
}

/**
 * Turns per-day counts into one running total per variant, over every date in the data, so the
 * lines share an x-axis even on days a variant had no traffic. A running rate settles as data
 * builds up, which is why an early lead in an A/B test often fades: reading it on day two is a trap.
 */
export function cumulativeSeries(daily: readonly DailyCount[], variants: readonly string[]): Map<string, TrendPoint[]> {
  const dates = [...new Set(daily.map((row) => row.date))].sort();
  const byKey = new Map(daily.map((row) => [`${row.date}|${row.variant}`, row]));
  const series = new Map<string, TrendPoint[]>();
  for (const variant of variants) {
    let exposures = 0;
    let conversions = 0;
    series.set(
      variant,
      dates.map((date) => {
        const row = byKey.get(`${date}|${variant}`);
        exposures += row?.exposures ?? 0;
        conversions += row?.conversions ?? 0;
        return { date, exposures, conversions, rate: exposures === 0 ? 0 : conversions / exposures };
      }),
    );
  }
  return series;
}
