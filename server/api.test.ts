import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { createTestServices } from './testing.js';

type Context = ReturnType<typeof createTestServices> & { url: string; close: () => Promise<void> };

let ctx: Context;

beforeEach(async () => {
  const context = createTestServices();
  const server = createApp({ services: context.services, logger: context.logger, metrics: context.metrics });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  ctx = {
    ...context,
    url: `http://127.0.0.1:${String(port)}`,
    close: () =>
      new Promise((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  };
});

afterEach(async () => {
  await ctx.close();
});

interface GraphQLResult<T> {
  data?: T;
  errors?: { message: string; extensions?: { code?: string } }[];
}

async function gql<T = Record<string, unknown>>(query: string, variables: Record<string, unknown> = {}, visitorId: string | null = 'visitor-0001') {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (visitorId) headers['x-visitor-id'] = visitorId;
  const response = await fetch(`${ctx.url}/graphql`, { method: 'POST', headers, body: JSON.stringify({ query, variables }) });
  return { status: response.status, headers: response.headers, body: (await response.json()) as GraphQLResult<T> };
}

interface Payload {
  membership: { id: string; status: string } | null;
  error: { code: string } | null;
}

const START = `mutation Start($input: StartMembershipInput!) {
  startMembership(input: $input) { membership { id status } error { code message } }
}`;
const CANCEL = `mutation Cancel($input: CancelMembershipInput!) {
  cancelMembership(input: $input) { membership { id status cancelledAt } error { code } }
}`;
const EXPOSE = 'mutation Expose($key: String!) { logExposure(experimentKey: $key) { assignment { variant } firstExposure } }';
const RESULTS = `query Results($key: String!) {
  experiment(key: $key) { results { totalExposures variants { key exposures conversions } } }
}`;

function start(idempotencyKey: string, planId = 'ANNUAL', paymentMethod = 'CARD_OK', visitorId = 'visitor-0001') {
  return gql<{ startMembership: Payload }>(START, { input: { planId, paymentMethod, idempotencyKey } }, visitorId);
}

describe('membership API', () => {
  it('joins, shows the membership on the viewer, and keeps the history', async () => {
    const joined = await start('key-0000001', 'MONTHLY');
    expect(joined.body.data?.startMembership.membership?.status).toBe('TRIAL');

    const viewer = await gql<{ viewer: { trialEligible: boolean; membership: { status: string; history: { event: string }[] } } }>(
      '{ viewer { trialEligible membership { status history { event } } } }',
    );
    expect(viewer.body.data?.viewer).toEqual({ trialEligible: false, membership: { status: 'TRIAL', history: [{ event: 'STARTED' }] } });
  });

  it('turns a double submit into one membership and one charge', async () => {
    const [a, b] = await Promise.all([start('key-0000001'), start('key-0000001')]);
    expect(a.body.data?.startMembership.membership?.id).toBeDefined();
    expect(b.body.data?.startMembership).toEqual(a.body.data?.startMembership);
    expect(ctx.payments.succeededCharges()).toHaveLength(1);
  });

  it('charges once when a response is lost and the client retries with the same key', async () => {
    // Every server-side retry fails, the last one after charging, so the request errors out.
    ctx.payments.injectFaults('transient', 'transient', 'lost_response');
    const failed = await start('key-0000001');
    expect(failed.body.errors?.[0]?.message).toBe('Unexpected error.');
    const retried = await start('key-0000001');
    expect(retried.body.data?.startMembership.membership?.status).toBe('ACTIVE');
    expect(ctx.payments.succeededCharges()).toHaveLength(1);
  });

  it('answers a decline as data, not as an error', async () => {
    const declined = await start('key-0000001', 'ANNUAL', 'CARD_DECLINES');
    expect(declined.body.errors).toBeUndefined();
    expect(declined.body.data?.startMembership).toMatchObject({ membership: null, error: { code: 'PAYMENT_DECLINED' } });
  });

  it('cancels once: same key replays, a new key finds nothing to cancel', async () => {
    await start('key-0000001');
    const first = await gql<{ cancelMembership: Payload }>(CANCEL, { input: { idempotencyKey: 'cancel-0001' } });
    const replay = await gql<{ cancelMembership: Payload }>(CANCEL, { input: { idempotencyKey: 'cancel-0001' } });
    const another = await gql<{ cancelMembership: Payload }>(CANCEL, { input: { idempotencyKey: 'cancel-0002' } });
    expect(first.body.data?.cancelMembership.membership?.status).toBe('CANCELLED');
    expect(replay.body.data).toEqual(first.body.data);
    expect(another.body.data?.cancelMembership.error?.code).toBe('NOT_A_MEMBER');
  });

  it('runs billing as a demo control', async () => {
    await start('key-0000001', 'MONTHLY');
    const billed = await gql<{ runBilling: Payload }>(
      'mutation Bill($input: RunBillingInput!) { runBilling(input: $input) { membership { status } error { code } } }',
      { input: { paymentMethod: 'CARD_DECLINES', idempotencyKey: 'bill-00001' } },
    );
    expect(billed.body.data?.runBilling).toEqual({ membership: { status: 'PAST_DUE' }, error: null });
  });

  it('rejects requests without a visitor id or with a malformed key', async () => {
    const anonymous = await gql('{ viewer { id } }', {}, null);
    expect(anonymous.body.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
    const badKey = await start('short');
    expect(badKey.body.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
    const unknown = await gql(EXPOSE, { key: 'no_such_experiment' });
    expect(unknown.body.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
  });
});

describe('experiment API', () => {
  it('assigns without exposing, and counts only conversions after exposure', async () => {
    const assignment = await gql<{ assignment: { variant: string } }>('{ assignment(experimentKey: "landing_hero") { variant } }');
    const empty = await gql<{ experiment: { results: { totalExposures: number } } }>(RESULTS, { key: 'landing_hero' });
    expect(empty.body.data?.experiment.results.totalExposures).toBe(0);

    // visitor-0001 is exposed and then converts; visitor-0002 converts and then is exposed.
    const exposed = await gql<{ logExposure: { assignment: { variant: string }; firstExposure: boolean } }>(EXPOSE, { key: 'landing_hero' });
    expect(exposed.body.data?.logExposure).toEqual({ assignment: assignment.body.data?.assignment, firstExposure: true });
    ctx.clock.advance(1000);
    await start('key-0000001');
    await start('key-0000002', 'ANNUAL', 'CARD_OK', 'visitor-0002');
    ctx.clock.advance(1000);
    await gql(EXPOSE, { key: 'landing_hero' }, 'visitor-0002');
    const repeat = await gql<{ logExposure: { firstExposure: boolean } }>(EXPOSE, { key: 'landing_hero' });
    expect(repeat.body.data?.logExposure.firstExposure).toBe(false);

    const results = await gql<{ experiment: { results: { totalExposures: number; variants: { conversions: number }[] } } }>(RESULTS, {
      key: 'landing_hero',
    });
    expect(results.body.data?.experiment.results.totalExposures).toBe(2);
    expect(results.body.data?.experiment.results.variants.reduce((sum, variant) => sum + variant.conversions, 0)).toBe(1);
  });

  it('lists every experiment with its variants', async () => {
    const list = await gql<{ experiments: { key: string; variants: { key: string }[] }[] }>('{ experiments { key variants { key } } }');
    expect(list.body.data?.experiments.map((experiment) => experiment.key)).toEqual(['landing_hero', 'signup_default_plan']);
  });
});

describe('operations endpoints', () => {
  it('reports health', async () => {
    const response = await fetch(`${ctx.url}/healthz`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('echoes a well-formed request id and replaces a malformed one', async () => {
    const kept = await fetch(`${ctx.url}/healthz`, { headers: { 'x-request-id': 'trace-12345678' } });
    expect(kept.headers.get('x-request-id')).toBe('trace-12345678');
    const replaced = await fetch(`${ctx.url}/healthz`, { headers: { 'x-request-id': 'bad id!' } });
    expect(replaced.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('exposes request rate, error rate and latency on /metrics', async () => {
    await start('key-0000001');
    ctx.payments.injectFaults('transient', 'transient', 'transient');
    await start('key-0000002', 'ANNUAL', 'CARD_OK', 'visitor-0002');
    await gql('{ nope }');

    const response = await fetch(`${ctx.url}/metrics`);
    expect(response.headers.get('content-type')).toContain('text/plain');
    const text = await response.text();
    expect(text).toContain('http_requests_total{route="/graphql",method="POST",status="200"} 3');
    expect(text).toContain('graphql_operations_total{operation="Start",type="mutation",outcome="success"} 1');
    expect(text).toContain('graphql_operations_total{operation="Start",type="mutation",outcome="error"} 1');
    expect(text).toContain('graphql_operations_total{operation="invalid",type="unknown",outcome="invalid"} 1');
    expect(text).toMatch(/http_request_duration_seconds_bucket\{le="0.1",route="\/graphql",method="POST"\} \d/);
    expect(text).toContain('payment_charges_total{outcome="transient_error"} 3');
    expect(text).toContain('process_cpu_user_seconds_total');
  });

  it('accepts Web Vitals beacons and reports their 75th percentile', async () => {
    for (const value of [1200, 1800, 2100, 3900]) {
      const response = await fetch(`${ctx.url}/vitals`, { method: 'POST', body: JSON.stringify({ name: 'LCP', value }) });
      expect(response.status).toBe(204);
    }
    const bad = await fetch(`${ctx.url}/vitals`, { method: 'POST', body: JSON.stringify({ name: 'FID', value: 10 }) });
    expect(bad.status).toBe(400);
    const tooBig = await fetch(`${ctx.url}/vitals`, { method: 'POST', body: 'x'.repeat(5000) });
    expect(tooBig.status).toBe(400);

    const vitals = await gql<{ webVitals: { name: string; p75: number; samples: number; rating: string }[] }>(
      '{ webVitals { name p75 samples rating } }',
    );
    expect(vitals.body.data?.webVitals).toEqual([{ name: 'LCP', p75: 2100, samples: 4, rating: 'GOOD' }]);
  });

  it('answers 404 for unknown paths when no web build is served', async () => {
    expect((await fetch(`${ctx.url}/nowhere`)).status).toBe(404);
  });
});
