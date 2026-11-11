import { describe, expect, it } from 'vitest';
import { breakEvenOrders, monthlySavings } from './savings';

describe('savings calculator', () => {
  it('nets the membership fee out of fee savings', () => {
    expect(monthlySavings(4)).toBe(10.97);
    expect(monthlySavings(1)).toBeLessThan(0);
  });

  it('breaks even at the first order count with positive savings', () => {
    const orders = breakEvenOrders();
    expect(monthlySavings(orders)).toBeGreaterThan(0);
    expect(monthlySavings(orders - 1)).toBeLessThanOrEqual(0);
  });
});
