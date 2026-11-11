import { createApp } from './app.js';
import { systemClock } from './clock.js';
import { loadConfig } from './config.js';
import { InMemoryRepository } from './db/memory-repository.js';
import { createLogger } from './observability/logger.js';
import { createMetrics } from './observability/metrics.js';
import { FakePaymentProvider } from './payments/fake-provider.js';
import { createServices } from './services.js';
import { seedDemoData } from './simulate/seed.js';

const config = loadConfig();
const logger = createLogger(config.logLevel);
const metrics = createMetrics();
const repo = new InMemoryRepository();

if (config.seedVisitors > 0) {
  const started = performance.now();
  const summary = await seedDemoData(repo, logger, config.seedVisitors);
  logger.info({ ...summary, ms: Math.round(performance.now() - started) }, 'seeded simulated traffic');
}

const services = createServices({
  repo,
  payments: new FakePaymentProvider(config.payment),
  clock: systemClock,
  logger,
  metrics,
});

const server = createApp({ services, logger, metrics, staticDir: config.staticDir, dev: config.dev });
server.listen(config.port, () => {
  logger.info({ port: config.port, dev: config.dev }, 'listening');
});

function shutdown(signal: string): void {
  logger.info({ signal }, 'shutting down');
  server.close(() => process.exit(0));
}
process.on('SIGINT', () => {
  shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
