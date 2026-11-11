import { rmSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { ManualClock } from '../server/clock.js';
import { SqliteRepository } from '../server/db/sqlite-repository.js';
import { createLogger } from '../server/observability/logger.js';
import { createMetrics } from '../server/observability/metrics.js';
import { FakePaymentProvider } from '../server/payments/fake-provider.js';
import { createServices } from '../server/services.js';
import { simulate } from '../server/simulate/simulator.js';

const { values } = parseArgs({
  options: {
    db: { type: 'string', default: process.env.DB_PATH || 'data/member-lab.db' },
    seed: { type: 'string', default: '42' },
    visitors: { type: 'string', default: '24000' },
  },
});

const dbPath = values.db;
for (const suffix of ['', '-wal', '-shm']) rmSync(`${dbPath}${suffix}`, { force: true });

const start = new Date('2026-09-01T08:00:00.000Z');
const clock = new ManualClock(start);
const repo = new SqliteRepository(dbPath);
const payments = new FakePaymentProvider();
const services = createServices({
  repo,
  payments,
  clock,
  logger: createLogger('warn'),
  metrics: createMetrics(),
  retry: { attempts: 3, baseDelayMs: 0 },
});

const began = performance.now();
const summary = await simulate(services, clock, {
  seed: Number(values.seed),
  visitors: Number(values.visitors),
  start,
  recruitDays: 14,
  totalDays: 45,
});
repo.close();

console.log(`Simulated ${String(summary.visitors)} visitors into ${dbPath} in ${(performance.now() - began).toFixed(0)} ms`);
console.table({ ...summary, succeededCharges: payments.succeededCharges().length });
console.log('Restart the server if it is running, then open /experiments.');
