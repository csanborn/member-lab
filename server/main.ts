import { systemClock } from './clock.js';
import { loadConfig } from './config.js';
import { SqliteRepository } from './db/sqlite-repository.js';
import { createApp } from './app.js';
import { createLogger } from './observability/logger.js';
import { createMetrics } from './observability/metrics.js';
import { FakePaymentProvider } from './payments/fake-provider.js';
import { createServices } from './services.js';

const config = loadConfig();
const logger = createLogger(config.logLevel);
const metrics = createMetrics();
const repo = new SqliteRepository(config.dbPath);
const services = createServices({
  repo,
  payments: new FakePaymentProvider(config.payment),
  clock: systemClock,
  logger,
  metrics,
});

const server = createApp({ services, logger, metrics, staticDir: config.staticDir, dev: config.dev });
server.listen(config.port, () => {
  logger.info({ port: config.port, dbPath: config.dbPath, dev: config.dev }, 'listening');
});

function shutdown(signal: string): void {
  logger.info({ signal }, 'shutting down');
  server.close(() => {
    repo.close();
    process.exit(0);
  });
}
process.on('SIGINT', () => {
  shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
