import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Membership, MembershipPayload } from '../api/types';
import { resetVisitor } from '../visitor';
import { Member } from './Member';

const trial: Membership = {
  id: 'm1',
  status: 'TRIAL',
  paymentMethod: 'CARD_OK',
  startedAt: '2026-11-01T12:00:00.000Z',
  trialEndsAt: '2026-12-01T12:00:00.000Z',
  currentPeriodEnd: '2026-12-01T12:00:00.000Z',
  cancelledAt: null,
  failedChargeCount: 0,
  plan: { id: 'MONTHLY', name: 'Monthly', priceCents: 999, interval: 'MONTH', trialDays: 30 },
  history: [{ id: 'h1', event: 'STARTED', fromStatus: null, toStatus: 'TRIAL', at: '2026-11-01T12:00:00.000Z', detail: null }],
};

/** A fake /graphql whose cancel answer waits until the test releases it. */
function fakeServer(cancelAnswer: MembershipPayload) {
  let membership = trial;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const { operationName } = JSON.parse(init.body as string) as { operationName: string };
    let data: unknown = null;
    if (operationName === 'Viewer') data = { viewer: { id: 'v', trialEligible: false, membership } };
    if (operationName === 'CancelMembership') {
      await gate;
      if (cancelAnswer.membership) membership = cancelAnswer.membership;
      data = { cancelMembership: cancelAnswer };
    }
    return new Response(JSON.stringify({ data }), { headers: { 'content-type': 'application/json' } });
  });
  return { fetchMock, release };
}

function renderMember() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Member />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function confirmCancel() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Cancel membership' }));
  const dialog = screen.getByRole('dialog', { name: 'Cancel Crate Club?' });
  await user.click(within(dialog).getByRole('button', { name: 'Yes, cancel' }));
}

beforeAll(() => {
  // jsdom has no modal dialogs. These stand-ins open and close the element like a browser would.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

beforeEach(() => {
  resetVisitor();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('optimistic cancel', () => {
  it('shows the cancellation before the server answers, and keeps it when the server agrees', async () => {
    const cancelled: Membership = { ...trial, status: 'CANCELLED', cancelledAt: '2026-11-02T12:00:00.000Z' };
    const server = fakeServer({ membership: cancelled, error: null });
    vi.stubGlobal('fetch', server.fetchMock);
    renderMember();

    await confirmCancel();
    expect(screen.getByTestId('membership-status')).toHaveTextContent('Cancelled');
    expect(screen.getByRole('link', { name: 'Rejoin Crate Club' })).toBeInTheDocument();

    server.release();
    await vi.waitFor(() => {
      expect(server.fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3);
    });
    expect(screen.getByTestId('membership-status')).toHaveTextContent('Cancelled');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('puts the membership back and says so when the server refuses', async () => {
    const server = fakeServer({ membership: null, error: { code: 'NOT_A_MEMBER', message: 'There is no active membership to cancel.' } });
    vi.stubGlobal('fetch', server.fetchMock);
    renderMember();

    await confirmCancel();
    expect(screen.getByTestId('membership-status')).toHaveTextContent('Cancelled');

    server.release();
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not cancel your membership');
    expect(screen.getByTestId('membership-status')).toHaveTextContent('Free trial');
    expect(screen.getByRole('button', { name: 'Cancel membership' })).toBeInTheDocument();
  });
});
