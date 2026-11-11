import { ManualClock } from './clock.js';
import { SqliteRepository } from './db/sqlite-repository.js';
import { createLogger } from './observability/logger.js';
import { createMetrics } from './observability/metrics.js';
import { FakePaymentProvider } from './payments/fake-provider.js';
import { createServices } from './services.js';

export const TEST_START = new Date('2026-10-01T12:00:00.000Z');

/** Everything a test needs, on a throwaway in-memory database with no retry delays. */
export function createTestServices() {
  const clock = new ManualClock(TEST_START);
  const repo = new SqliteRepository(':memory:');
  const payments = new FakePaymentProvider();
  const metrics = createMetrics();
  const logger = createLogger('silent');
  const services = createServices({ repo, payments, clock, logger, metrics, retry: { attempts: 3, baseDelayMs: 0 } });
  return { clock, repo, payments, metrics, logger, services };
}
