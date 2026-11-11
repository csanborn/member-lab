import { useId, useRef, useState, type SyntheticEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { newIdempotencyKey } from '../api/client';
import { useAssignment, usePlans, useStartMembership, useViewer } from '../api/hooks';
import type { DemoPaymentMethod, Plan, PlanId } from '../api/types';
import { useExposure } from '../experiments/useExposure';
import { formatCents, intervalLabel } from '../format';

const PAYMENT_METHODS: { id: DemoPaymentMethod; label: string; hint: string }[] = [
  { id: 'CARD_OK', label: 'Demo card A', hint: 'Always approved' },
  { id: 'CARD_DECLINES', label: 'Demo card B', hint: 'Always declined' },
];

function planCopy(plan: Plan, trialEligible: boolean) {
  const withTrial = plan.trialDays > 0 && trialEligible;
  return {
    withTrial,
    detail: withTrial
      ? `${String(plan.trialDays)} days free, then ${formatCents(plan.priceCents)} a ${intervalLabel(plan)}`
      : `${formatCents(plan.priceCents)} today, then every ${intervalLabel(plan)}`,
  };
}

/** Rendered only once the default plan is known, so its exposure is logged when the form is on screen. */
function JoinForm({ plans, defaultPlan, trialEligible }: { plans: Plan[]; defaultPlan: PlanId; trialEligible: boolean }) {
  useExposure('signup_default_plan');
  const navigate = useNavigate();
  const start = useStartMembership();
  const [planId, setPlanId] = useState<PlanId>(defaultPlan);
  const [paymentMethod, setPaymentMethod] = useState<DemoPaymentMethod>('CARD_OK');
  // One key per intent. Every retry of this exact submission (network retries, a second click)
  // reuses it, so the server joins at most once. Changing the form or getting an answer makes a new one.
  const idempotencyKey = useRef(newIdempotencyKey());
  const statusId = useId();

  const selected = plans.find((plan) => plan.id === planId);
  const error = start.data?.error ?? null;
  const failure = start.error;

  function change(update: () => void) {
    update();
    idempotencyKey.current = newIdempotencyKey();
    start.reset();
  }

  function submit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    if (start.isPending) return;
    // mutateAsync, not mutate: saving the new membership re-renders this page as "already a
    // member" and unmounts the form, and mutate's callbacks would not run after that.
    start
      .mutateAsync({ planId, paymentMethod, idempotencyKey: idempotencyKey.current })
      .then((payload) => {
        idempotencyKey.current = newIdempotencyKey();
        if (payload.membership && !payload.error) void navigate('/member');
      })
      .catch(() => {
        // Shown from start.error. The key is kept, so trying again is safe.
      });
  }

  const copy = selected ? planCopy(selected, trialEligible) : undefined;
  const submitLabel = copy?.withTrial ? 'Start free trial' : `Join and pay ${selected ? formatCents(selected.priceCents) : ''}`;

  return (
    <form className="join-form" onSubmit={submit} aria-describedby={statusId} noValidate>
      <fieldset className="choice-group">
        <legend>Choose a plan</legend>
        {plans.map((plan) => {
          const { detail } = planCopy(plan, trialEligible);
          return (
            <label key={plan.id} className="choice" data-testid={`plan-${plan.id}`}>
              <input
                type="radio"
                name="plan"
                value={plan.id}
                checked={planId === plan.id}
                onChange={() => {
                  change(() => {
                    setPlanId(plan.id);
                  });
                }}
              />
              <span className="choice__body">
                <span className="choice__title">
                  {plan.name}
                  {plan.id === 'ANNUAL' && <span className="tag">Best value</span>}
                </span>
                <span className="choice__detail">{detail}</span>
              </span>
            </label>
          );
        })}
      </fieldset>

      <fieldset className="choice-group">
        <legend>Payment method</legend>
        <p className="hint">This demo has no real cards. Pick how the fake payment provider should answer.</p>
        {PAYMENT_METHODS.map((method) => (
          <label key={method.id} className="choice choice--compact">
            <input
              type="radio"
              name="payment"
              value={method.id}
              checked={paymentMethod === method.id}
              onChange={() => {
                change(() => {
                  setPaymentMethod(method.id);
                });
              }}
            />
            <span className="choice__body">
              <span className="choice__title">{method.label}</span>
              <span className="choice__detail">{method.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div id={statusId} className="form-status">
        {error && (
          <p className="alert alert--error" role="alert">
            {error.message}
          </p>
        )}
        {failure && (
          <p className="alert alert--error" role="alert">
            {failure.message} Your card was not charged twice: it is safe to try again.
          </p>
        )}
        {copy?.withTrial && <p className="hint">You will not be charged today. Cancel before the trial ends and you pay nothing.</p>}
      </div>

      <button type="submit" className="button button--primary button--large" disabled={start.isPending} aria-busy={start.isPending}>
        {start.isPending ? 'Joining…' : submitLabel}
      </button>
    </form>
  );
}

export function Join() {
  const viewer = useViewer();
  const plans = usePlans();
  const defaultPlan = useAssignment('signup_default_plan');

  const live = viewer.data?.membership && viewer.data.membership.status !== 'CANCELLED';
  const ready = viewer.data && plans.data && defaultPlan.data;
  const failed = viewer.isError || plans.isError || defaultPlan.isError;

  return (
    <div className="container page narrow">
      <h1>Join Crate Club</h1>
      {failed && (
        <p className="alert alert--error" role="alert">
          The signup form could not load. Refresh the page to try again.
        </p>
      )}
      {live ? (
        <p className="alert alert--info">
          You are already a member. <Link to="/member">See your membership</Link>.
        </p>
      ) : ready ? (
        <JoinForm
          plans={plans.data}
          defaultPlan={defaultPlan.data === 'annual_default' ? 'ANNUAL' : 'MONTHLY'}
          trialEligible={viewer.data.trialEligible}
        />
      ) : (
        !failed && (
          <div aria-busy="true" className="skeleton-stack">
            <span className="visually-hidden">Loading the signup form</span>
            <div className="skeleton skeleton--card" />
            <div className="skeleton skeleton--card" />
          </div>
        )
      )}
    </div>
  );
}
