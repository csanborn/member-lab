import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

const LATENCY_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];

/** One registry per app instance, so tests can run several apps in one process. */
export function createMetrics() {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });

  return {
    registry,
    httpRequests: new Counter({
      name: 'http_requests_total',
      help: 'HTTP requests by route, method and status code.',
      labelNames: ['route', 'method', 'status'] as const,
      registers: [registry],
    }),
    httpDuration: new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request latency.',
      labelNames: ['route', 'method'] as const,
      buckets: LATENCY_BUCKETS,
      registers: [registry],
    }),
    graphqlOperations: new Counter({
      name: 'graphql_operations_total',
      help: 'GraphQL operations by name and outcome (success, error or invalid).',
      labelNames: ['operation', 'type', 'outcome'] as const,
      registers: [registry],
    }),
    graphqlDuration: new Histogram({
      name: 'graphql_operation_duration_seconds',
      help: 'GraphQL execution latency by operation.',
      labelNames: ['operation', 'type'] as const,
      buckets: LATENCY_BUCKETS,
      registers: [registry],
    }),
    paymentCharges: new Counter({
      name: 'payment_charges_total',
      help: 'Calls to the payment provider by outcome (succeeded, declined or transient_error).',
      labelNames: ['outcome'] as const,
      registers: [registry],
    }),
  };
}

export type Metrics = ReturnType<typeof createMetrics>;
