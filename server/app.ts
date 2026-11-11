import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createYoga, maskError } from 'graphql-yoga';
import sirv from 'sirv';
import { useOperationMetrics } from './graphql/metrics-plugin.js';
import { createGraphQLSchema, type GraphQLContext } from './graphql/schema.js';
import type { Logger } from './observability/logger.js';
import type { Metrics } from './observability/metrics.js';
import type { Services } from './services.js';
import { isVitalName } from './vitals.js';

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
const MAX_BEACON_BYTES = 2048;

/** Only well-formed ids are trusted, whether a request id or a visitor id. */
function safeId(value: string | string[] | null | undefined): string | null {
  return typeof value === 'string' && SAFE_ID.test(value) ? value : null;
}

/** Fixed route labels keep metric cardinality bounded whatever paths clients send. */
function routeOf(path: string): string {
  if (path === '/graphql' || path === '/metrics' || path === '/healthz' || path === '/vitals') return path;
  return path.startsWith('/assets/') ? 'asset' : 'page';
}

async function readSmallBody(req: IncomingMessage): Promise<string | null> {
  let body = '';
  for await (const chunk of req) {
    body += String(chunk);
    if (body.length > MAX_BEACON_BYTES) return null;
  }
  return body;
}

/**
 * The whole HTTP surface: GraphQL, a Web Vitals beacon, Prometheus metrics, a health check and
 * the built web app. Every request is counted, timed and logged as one JSON line.
 */
export function createApp({ services, logger, metrics, staticDir, dev = false }: AppOptions): Server {
  const yoga = createYoga({
    schema: createGraphQLSchema(),
    graphqlEndpoint: '/graphql',
    graphiql: dev,
    landingPage: false,
    logging: false,
    context: ({ request }): GraphQLContext => ({ userId: safeId(request.headers.get('x-visitor-id')), services }),
    maskedErrors: {
      // Clients see "Unexpected error." for bugs and outages. The real error goes to the log.
      maskError(error, message, isDev) {
        const masked = maskError(error, message, isDev);
        if (masked.message === message) logger.error({ err: error }, 'unexpected GraphQL error');
        return masked;
      },
    },
    plugins: [useOperationMetrics(metrics)],
  });

  const serveStatic = staticDir && existsSync(staticDir) ? sirv(staticDir, { single: true, etag: true }) : undefined;

  function send(res: ServerResponse, status: number, contentType: string, body: string): void {
    res.statusCode = status;
    res.setHeader('content-type', contentType);
    res.end(body);
  }

  async function recordVital(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readSmallBody(req);
    try {
      const { name, value } = JSON.parse(body ?? '') as { name?: unknown; value?: unknown };
      if (isVitalName(name) && typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        services.vitals.record(name, value);
        res.statusCode = 204;
        res.end();
        return;
      }
    } catch {
      // Not JSON: answered below.
    }
    send(res, 400, 'text/plain', 'Expected {"name": "LCP" | "INP" | "CLS" | "FCP" | "TTFB", "value": number}');
  }

  async function route(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    if (path === '/graphql') {
      await yoga.handle(req, res);
    } else if (path === '/metrics') {
      send(res, 200, metrics.registry.contentType, await metrics.registry.metrics());
    } else if (path === '/healthz') {
      send(res, 200, 'application/json', '{"status":"ok"}');
    } else if (path === '/vitals' && req.method === 'POST') {
      await recordVital(req, res);
    } else if (serveStatic) {
      serveStatic(req, res, () => {
        send(res, 404, 'text/plain', 'Not found');
      });
    } else {
      send(res, 404, 'text/plain', 'Not found');
    }
  }

  return createServer((req, res) => {
    const requestId = safeId(req.headers['x-request-id']) ?? randomUUID();
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const routeLabel = routeOf(path);
    const method = req.method ?? 'GET';
    const started = performance.now();
    res.setHeader('x-request-id', requestId);

    res.on('finish', () => {
      const seconds = (performance.now() - started) / 1000;
      metrics.httpRequests.inc({ route: routeLabel, method, status: String(res.statusCode) });
      metrics.httpDuration.observe({ route: routeLabel, method }, seconds);
      const line = { requestId, method, path, status: res.statusCode, durationMs: Math.round(seconds * 1000) };
      if (res.statusCode >= 500) logger.error(line, 'request');
      else if (routeLabel === '/graphql' || routeLabel === 'page') logger.info(line, 'request');
      else logger.debug(line, 'request');
    });

    route(req, res, path).catch((error: unknown) => {
      logger.error({ err: error, requestId }, 'unhandled request error');
      if (!res.headersSent) res.statusCode = 500;
      res.end();
    });
  });
}
