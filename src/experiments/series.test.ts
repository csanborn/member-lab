import { describe, expect, it } from 'vitest';
import { cumulativeSeries } from './series';

describe('cumulativeSeries', () => {
  it('keeps running totals per variant on a shared set of dates', () => {
    const series = cumulativeSeries(
      [
        { date: '2026-09-01', variant: 'control', exposures: 100, conversions: 5 },
        { date: '2026-09-01', variant: 'treatment', exposures: 100, conversions: 8 },
        { date: '2026-09-02', variant: 'control', exposures: 100, conversions: 15 },
        { date: '2026-09-03', variant: 'treatment', exposures: 0, conversions: 2 },
      ],
      ['control', 'treatment'],
    );
    expect(series.get('control')).toEqual([
      { date: '2026-09-01', exposures: 100, conversions: 5, rate: 0.05 },
      { date: '2026-09-02', exposures: 200, conversions: 20, rate: 0.1 },
      { date: '2026-09-03', exposures: 200, conversions: 20, rate: 0.1 },
    ]);
    expect(series.get('treatment')?.map((point) => point.rate)).toEqual([0.08, 0.08, 0.1]);
  });

  it('reports a zero rate before a variant has any exposures', () => {
    const series = cumulativeSeries([{ date: '2026-09-02', variant: 'control', exposures: 10, conversions: 1 }], ['control', 'treatment']);
    expect(series.get('treatment')).toEqual([{ date: '2026-09-02', exposures: 0, conversions: 0, rate: 0 }]);
  });
});
