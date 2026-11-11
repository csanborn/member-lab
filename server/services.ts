import type { Clock } from './clock.js';
import type { Repository } from './db/repository.js';
import { ExperimentService } from './experiments/service.js';
import { MembershipService, type RetryPolicy } from './membership/service.js';
import type { Logger } from './observability/logger.js';
import type { Metrics } from './observability/metrics.js';
import type { PaymentProvider } from './payments/provider.js';

export interface Services {
  repo: Repository;
  memberships: MembershipService;
  experiments: ExperimentService;
}

export interface ServiceDeps {
  repo: Repository;
  payments: PaymentProvider;
  clock: Clock;
  logger: Logger;
  metrics: Metrics;
  retry?: RetryPolicy;
}

export function createServices(deps: ServiceDeps): Services {
  return {
    repo: deps.repo,
    memberships: new MembershipService(deps),
    experiments: new ExperimentService(deps),
  };
}
