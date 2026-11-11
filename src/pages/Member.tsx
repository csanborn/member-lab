import { useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { newIdempotencyKey } from '../api/client';
import { useCancelMembership, useRunBilling, useViewer } from '../api/hooks';
import type { DemoPaymentMethod, HistoryEntry, Membership } from '../api/types';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Perks } from '../components/Perks';
import { StatusBadge } from '../components/StatusBadge';
import { statusLabel } from '../status';
import { formatCents, formatDate, formatDateTime, intervalLabel } from '../format';

const EVENT_LABELS: Record<HistoryEntry['event'], string> = {
  STARTED: 'Joined',
  CHARGE_SUCCEEDED: 'Payment succeeded',
  CHARGE_FAILED: 'Payment failed',
  GRACE_EXPIRED: 'Cancelled after failed payments',
  CANCEL: 'Cancelled',
};

function Summary({ membership }: { membership: Membership }) {
  const { plan } = membership;
  const rows: [string, string][] = [
    ['Plan', `${plan.name}, ${formatCents(plan.priceCents)} a ${intervalLabel(plan)}`],
    ['Member since', formatDate(membership.startedAt)],
  ];
  if (membership.status === 'TRIAL') rows.push(['Free trial ends', formatDate(membership.currentPeriodEnd)]);
  if (membership.status === 'ACTIVE') rows.push(['Next charge', formatDate(membership.currentPeriodEnd)]);
  if (membership.status === 'PAST_DUE') rows.push(['Failed charges in a row', String(membership.failedChargeCount)]);
  if (membership.cancelledAt) {
    rows.push(['Cancelled on', formatDate(membership.cancelledAt)]);
    rows.push(['Perks last until', formatDate(membership.currentPeriodEnd)]);
  }
  return (
    <dl className="summary">
      {rows.map(([term, value]) => (
        <div key={term} className="summary__row">
          <dt>{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function BillingControls({ membership }: { membership: Membership }) {
  const runBilling = useRunBilling();
  const [paymentMethod, setPaymentMethod] = useState<DemoPaymentMethod>('CARD_OK');
  const idempotencyKey = useRef(newIdempotencyKey());
  const selectId = useId();
  const action =
    membership.status === 'TRIAL' ? 'End the trial and charge now' : membership.status === 'PAST_DUE' ? 'Retry the payment now' : 'Renew now';

  return (
    <section className="card" aria-labelledby="billing-title">
      <h2 id="billing-title">Demo billing controls</h2>
      <p className="hint">
        The demo has no scheduler, so you move time forward by hand. Each run is one charge with its own idempotency key.
      </p>
      <div className="inline-form">
        <label htmlFor={selectId}>Pay with</label>
        <select
          id={selectId}
          value={paymentMethod}
          onChange={(event) => {
            setPaymentMethod(event.target.value as DemoPaymentMethod);
            idempotencyKey.current = newIdempotencyKey();
          }}
        >
          <option value="CARD_OK">Demo card A (approved)</option>
          <option value="CARD_DECLINES">Demo card B (declined)</option>
        </select>
        <button
          type="button"
          className="button button--secondary"
          disabled={runBilling.isPending}
          aria-busy={runBilling.isPending}
          onClick={() => {
            runBilling
              .mutateAsync({ paymentMethod, idempotencyKey: idempotencyKey.current })
              .then(() => {
                idempotencyKey.current = newIdempotencyKey();
              })
              .catch(() => {
                // Shown below. The key is kept so a retry cannot charge twice.
              });
          }}
        >
          {runBilling.isPending ? 'Charging…' : action}
        </button>
      </div>
      {runBilling.error && (
        <p className="alert alert--error" role="alert">
          {runBilling.error.message}
        </p>
      )}
    </section>
  );
}

function History({ entries }: { entries: HistoryEntry[] }) {
  return (
    <section className="card" aria-labelledby="history-title">
      <h2 id="history-title">History</h2>
      <ol className="timeline">
        {[...entries].reverse().map((entry) => (
          <li key={entry.id}>
            <span className="timeline__event">{EVENT_LABELS[entry.event]}</span>
            <span className="timeline__meta">
              <time dateTime={entry.at}>{formatDateTime(entry.at)}</time>
              {entry.fromStatus && entry.fromStatus !== entry.toStatus
                ? `: ${statusLabel(entry.fromStatus)} to ${statusLabel(entry.toStatus)}`
                : `: ${statusLabel(entry.toStatus)}`}
              {entry.detail && ` (${entry.detail})`}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function MembershipView({ membership }: { membership: Membership }) {
  const cancel = useCancelMembership();
  const [confirming, setConfirming] = useState(false);
  const idempotencyKey = useRef(newIdempotencyKey());
  const heading = useRef<HTMLHeadingElement>(null);
  const live = membership.status !== 'CANCELLED';

  // The cancel is optimistic: the dialog closes and the page shows "Cancelled" straight away.
  // If the server refuses or cannot be reached, the hook restores the membership and we say so.
  function confirmCancel() {
    setConfirming(false);
    // The button that opened the dialog is about to be replaced, so give focus a stable home.
    requestAnimationFrame(() => heading.current?.focus());
    cancel.mutate(
      { idempotencyKey: idempotencyKey.current },
      {
        onSuccess: () => {
          idempotencyKey.current = newIdempotencyKey();
        },
      },
    );
  }

  const cancelFailed = cancel.isError || Boolean(cancel.data?.error);

  return (
    <>
      <div className="member-head">
        <div>
          <h1 ref={heading} tabIndex={-1}>
            Your membership
          </h1>
          <p className="member-head__status">
            <StatusBadge status={membership.status} />
          </p>
        </div>
        {live ? (
          <button
            type="button"
            className="button button--secondary"
            onClick={() => {
              setConfirming(true);
            }}
          >
            Cancel membership
          </button>
        ) : (
          <Link to="/join" className="button button--primary">
            Rejoin Crate Club
          </Link>
        )}
      </div>

      <p className="visually-hidden" role="status">
        {membership.status === 'CANCELLED' && (cancel.isPending || cancel.isSuccess) ? 'Your membership is cancelled.' : ''}
      </p>
      {cancelFailed && (
        <p className="alert alert--error" role="alert">
          We could not cancel your membership, so it is still {statusLabel(membership.status).toLowerCase()}. Please try
          again.
        </p>
      )}
      {membership.status === 'PAST_DUE' && (
        <p className="alert alert--warning">
          Your last payment failed. Your perks keep working while we retry, and the membership is cancelled after three failed
          charges in a row.
        </p>
      )}

      <div className="member-grid">
        <section className="card" aria-labelledby="details-title">
          <h2 id="details-title">Details</h2>
          <Summary membership={membership} />
        </section>
        {live && <BillingControls membership={membership} />}
      </div>

      {live && (
        <section className="section section--flush" aria-labelledby="perks-title">
          <h2 id="perks-title">Your perks</h2>
          <Perks />
        </section>
      )}

      <History entries={membership.history} />

      <ConfirmDialog
        open={confirming}
        title="Cancel Crate Club?"
        confirmLabel="Yes, cancel"
        cancelLabel="Keep my membership"
        onConfirm={confirmCancel}
        onClose={() => {
          setConfirming(false);
        }}
      >
        <p>
          You will lose free delivery and member prices after {formatDate(membership.currentPeriodEnd)}. You will not be charged
          again.
        </p>
      </ConfirmDialog>
    </>
  );
}

export function Member() {
  const { data: viewer, isPending, isError } = useViewer();
  return (
    <div className="container page">
      {isError ? (
        <>
          <h1>Your membership</h1>
          <p className="alert alert--error" role="alert">
            Your membership could not load. Refresh the page to try again.
          </p>
        </>
      ) : isPending ? (
        <div aria-busy="true">
          <h1>Your membership</h1>
          <div className="skeleton skeleton--card" />
        </div>
      ) : viewer.membership ? (
        <MembershipView membership={viewer.membership} />
      ) : (
        <div className="narrow">
          <h1>Your membership</h1>
          <p>You are not a member yet.</p>
          <Link to="/join" className="button button--primary">
            Start your free trial
          </Link>
        </div>
      )}
    </div>
  );
}
