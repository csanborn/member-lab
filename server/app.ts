import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createYoga, maskError } from 'graphql-yoga';
import sirv from 'sirv';
import { createGraphQLSchema, type GraphQLContext } from './graphql/schema.js';
import { useOperationMetrics } from './graphql/metrics-plugin.js';
import type { Logger } from './observability/logger.js';
import type { Metrics } from './observability/metrics.js';
import { requestContext } from './observability/request-context.js';
import type { Services } from './services.js';

export interface AppOptions {
  services: Services;
  logger: Logger;
  metrics: Metrics;
  /** Built web app to serve, with an SPA fallback to index.html. */
  staticDir?: string;
  /** Turns on GraphiQL at /graphql. */
  dev?: boolean;
}

const SAFE_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** Only well-formed ids are trusted, whether a request id or a visitor id. */
function safeId(value: string | string[] | null | undefined): string | null {
  return typeof value === 'string' && SAFE_ID.test(value) ? value : null;
}

/** Fixed route labels keep metric cardinality bounded whatever paths clients send. */
function routeOf(path: string): string {
  if (path === '/graphql' || path === '/metrics' || path === '/healthz') return path;
  return path.startsWith('/assets/') ? 'asset' : 'page';
}

export function createApp({ services, logger, metrics, staticDir, dev = false }: AppOptions): Server {
  const yoga = createYoga({
    schema: createGraphQLSchema(),
    graphqlEndpoint: '/graphql',
    graphiql: dev,
    landingPage: false,
    logging: false,
    context: ({ request }): GraphQLContext => ({ userId: safeId(request.headers.get('x-visitor-id')), services }),
    maskedErrors: {
      maskError(error, message, isDev) {
        const masked = maskError(error, message, isDev);
        if (masked.message === message) logger.error({ err: error }, 'unexpected GraphQL error');
        return masked;
      },
    },
    plugins: [useOperationMetrics(metrics)],
  });

  const serveStatic = staticDir && existsSync(staticDir) ? sirv(staticDir, { single: true, etag: true }) : undefined;

  async function route(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    if (path === '/graphql') {
      await yoga.handle(req, res);
      return;
    }
    if (path === '/metrics') {
      res.setHeader('content-type', metrics.registry.contentType);
      res.end(await metrics.registry.metrics());
      return;
    }
    if (path === '/healthz') {
      const healthy = services.repo.ping();
      res.statusCode = healthy ? 200 : 503;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ status: healthy ? 'ok' : 'unavailable' }));
      return;
    }
    if (serveStatic) {
      serveStatic(req, res, () => {
        res.statusCode = 404;
        res.end('Not found');
      });
      return;
    }
    res.statusCode = 404;
    res.end('Not found');
  }

  return createServer((req, res) => {
    const requestId = safeId(req.headers['x-request-id']) ?? randomUUID();
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const routeLabel = routeOf(path);
    const method = req.method ?? 'GET';
    const started = process.hrtime.bigint();
    const context = { requestId } as { requestId: string; operationName?: string };
    res.setHeader('x-request-id', requestId);

    res.on('finish', () => {
      const seconds = Number(process.hrtime.bigint() - started) / 1e9;
      metrics.httpRequests.inc({ route: routeLabel, method, status: String(res.statusCode) });
      metrics.httpDuration.observe({ route: routeLabel, method }, seconds);
      const line = { requestId, method, path, route: routeLabel, status: res.statusCode, durationMs: Math.round(seconds * 1000), operation: context.operationName };
      if (res.statusCode >= 500) logger.error(line, 'request');
      else if (routeLabel === 'asset' || routeLabel === '/metrics') logger.debug(line, 'request');
      else logger.info(line, 'request');
    });

    requestContext.run(context, () => {
      route(req, res, path).catch((error: unknown) => {
        logger.error({ err: error }, 'unhandled request error');
        if (!res.headersSent) res.statusCode = 500;
        res.end();
      });
    });
  });
}
