import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetVisitor } from '../visitor';
import { Landing } from './Landing';

interface Call {
  operationName: string;
  visitorId: string | null;
}

/** A fake /graphql. The assignment answer is held until the test releases it. */
function fakeServer(variant: string) {
  const calls: Call[] = [];
  let release: () => void = () => undefined;
  const assignmentGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const answers: Record<string, () => unknown> = {
    Assignment: () => ({ assignment: { variant } }),
    LogExposure: () => ({ logExposure: { firstExposure: true } }),
    Viewer: () => ({ viewer: { id: 'v', trialEligible: true, membership: null } }),
    Plans: () => ({ plans: [] }),
  };
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as { operationName: string };
    calls.push({ operationName: body.operationName, visitorId: new Headers(init.headers).get('x-visitor-id') });
    if (body.operationName === 'Assignment') await assignmentGate;
    const answer = answers[body.operationName];
    return new Response(JSON.stringify({ data: answer ? answer() : null }), { headers: { 'content-type': 'application/json' } });
  });
  return { calls, fetchMock, release, exposures: () => calls.filter((call) => call.operationName === 'LogExposure') };
}

function renderLanding() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (
    <StrictMode>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Landing />
        </MemoryRouter>
      </QueryClientProvider>
    </StrictMode>
  );
  const view = render(tree);
  return {
    ...view,
    rerenderSame: () => {
      view.rerender(tree);
    },
  };
}

beforeEach(() => {
  resetVisitor();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('landing hero exposure', () => {
  it.each(['control', 'savings_calculator'])('logs one exposure, only after the %s variant renders', async (variant) => {
    const server = fakeServer(variant);
    vi.stubGlobal('fetch', server.fetchMock);
    const view = renderLanding();

    // Assignment is in flight: a skeleton shows, and nothing is logged.
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId('hero')).toBeNull();
    expect(server.calls.some((call) => call.operationName === 'Assignment')).toBe(true);
    expect(server.exposures()).toHaveLength(0);

    server.release();
    const hero = await screen.findByTestId('hero');
    expect(hero.dataset.variant).toBe(variant);
    await vi.waitFor(() => {
      expect(server.exposures()).toHaveLength(1);
    });

    // Re-rendering, and Strict Mode's double effects, do not log again.
    view.rerenderSame();
    await act(async () => {
      await Promise.resolve();
    });
    expect(server.exposures()).toHaveLength(1);
    expect(server.exposures()[0]?.visitorId).toBe(server.calls[0]?.visitorId);
  });

  it('logs nothing when the assignment fails and the fallback hero shows', async () => {
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      const { operationName } = JSON.parse(init.body as string) as { operationName: string };
      if (operationName === 'Assignment') return Promise.resolve(new Response('', { status: 503 }));
      return Promise.resolve(new Response(JSON.stringify({ data: { viewer: { id: 'v', trialEligible: true, membership: null }, plans: [] } })));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderLanding();
    const hero = await screen.findByTestId('hero');
    expect(hero.dataset.variant).toBeUndefined();
    const operations = fetchMock.mock.calls.map(([, init]) => (JSON.parse(init.body as string) as { operationName: string }).operationName);
    expect(operations).not.toContain('LogExposure');
  });
});
