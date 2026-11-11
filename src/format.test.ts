import { describe, expect, it } from 'vitest';
import { formatCents, formatPercent, formatPoints, formatPValue } from './format';

describe('format', () => {
  it('drops cents only on whole dollar amounts', () => {
    expect(formatCents(7900)).toBe('$79');
    expect(formatCents(999)).toBe('$9.99');
  });

  it('signs lifts and rounds rates', () => {
    expect(formatPercent(0.1234)).toBe('12.3%');
    expect(formatPercent(0.184, { signed: true })).toBe('+18.4%');
    expect(formatPercent(-0.083, { signed: true })).toBe('-8.3%');
    expect(formatPoints(0.0159)).toBe('+1.6 pts');
    expect(formatPoints(-0.038)).toBe('-3.8 pts');
  });

  it('floors tiny p-values', () => {
    expect(formatPValue(0.0000012)).toBe('< 0.001');
    expect(formatPValue(0.01234)).toBe('0.012');
  });
});
