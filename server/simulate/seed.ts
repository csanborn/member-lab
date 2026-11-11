import { DAY_MS, ManualClock } from '../clock.js';
import type { Repository } from '../db/repository.js';
import type { Logger } from '../observability/logger.js';
import { createMetrics } from '../observability/metrics.js';
import { FakePaymentProvider } from '../payments/fake-provider.js';
import { createServices } from '../services.js';
import { simulate, type SimulationSummary } from './simulator.js';

const TOTAL_DAYS = 45;

/**
 * Fills the repository with a seeded, reproducible run that ends now: two weeks of experiment
 * traffic starting 45 days ago, then a month of trials ending, renewing and cancelling. It uses
 * its own clock and its own metrics, so none of it shows up as live traffic.
 */
export async function seedDemoData(repo: Repository, logger: Logger, visitors: number, now = new Date()): Promise<SimulationSummary> {
  const start = new Date(Math.floor((now.getTime() - TOTAL_DAYS * DAY_MS) / DAY_MS) * DAY_MS);
  const clock = new ManualClock(start);
  const services = createServices({
    repo,
    clock,
    payments: new FakePaymentProvider(),
    logger: logger.child({}, { level: 'warn' }),
    metrics: createMetrics(),
    retry: { attempts: 3, baseDelayMs: 0 },
  });
  return simulate(services, clock, { seed: 42, visitors, start, recruitDays: 14, totalDays: TOTAL_DAYS });
}
