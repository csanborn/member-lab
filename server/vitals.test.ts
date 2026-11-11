import { describe, expect, it } from 'vitest';
import { VitalsStore, percentile75, rate } from './vitals.js';

describe('vitals', () => {
  it('takes the 75th percentile as the value three in four samples meet', () => {
    expect(percentile75([4, 1, 3, 2])).toBe(3);
    expect(percentile75([10])).toBe(10);
    expect(percentile75([])).toBe(0);
  });

  it('rates against the published thresholds, inclusive of the good boundary', () => {
    expect(rate('LCP', 2500)).toBe('good');
    expect(rate('LCP', 2501)).toBe('needs-improvement');
    expect(rate('LCP', 4001)).toBe('poor');
    expect(rate('CLS', 0.05)).toBe('good');
    expect(rate('INP', 600)).toBe('poor');
  });

  it('summarizes only vitals that have samples, and keeps the most recent 1,000', () => {
    const store = new VitalsStore();
    for (let i = 0; i < 1500; i += 1) store.record('CLS', i < 500 ? 1 : 0.01);
    store.record('LCP', 1000);
    expect(store.summary()).toEqual([
      { name: 'LCP', p75: 1000, samples: 1, rating: 'good' },
      { name: 'CLS', p75: 0.01, samples: 1000, rating: 'good' },
    ]);
  });
});
