const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const wholeCurrency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const date = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const dateTime = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const integer = new Intl.NumberFormat('en-US');

export function formatCents(cents: number): string {
  return cents % 100 === 0 ? wholeCurrency.format(cents / 100) : currency.format(cents / 100);
}

export function formatDollars(dollars: number): string {
  return currency.format(dollars);
}

export function formatDate(iso: string): string {
  return date.format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

export function formatCount(value: number): string {
  return integer.format(value);
}

/** 0.1234 as "12.3%". Signed values get an explicit plus. */
export function formatPercent(value: number, { signed = false } = {}): string {
  const text = `${(Math.abs(value) * 100).toFixed(1)}%`;
  if (!signed || value === 0) return value < 0 ? `-${text}` : text;
  return value > 0 ? `+${text}` : `-${text}`;
}

/** Percentage points, for differences between two rates. */
export function formatPoints(value: number): string {
  const points = (value * 100).toFixed(1);
  return `${value > 0 ? '+' : ''}${points} pts`;
}

export function formatPValue(p: number): string {
  if (p < 0.001) return '< 0.001';
  return p.toFixed(3);
}

export function intervalLabel(plan: { interval: 'MONTH' | 'YEAR' }): string {
  return plan.interval === 'MONTH' ? 'month' : 'year';
}
