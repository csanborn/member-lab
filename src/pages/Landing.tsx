import { useId, useState } from 'react';
import { Link } from 'react-router';
import { useAssignment, usePlans, usePrefetchJoin, useViewer } from '../api/hooks';
import { Perks } from '../components/Perks';
import { useExposure } from '../experiments/useExposure';
import { formatCents, formatDollars, intervalLabel } from '../format';
import { breakEvenOrders, monthlySavings } from '../savings';

function useCallToAction() {
  const { data: viewer } = useViewer();
  const live = viewer?.membership && viewer.membership.status !== 'CANCELLED';
  if (live) return { to: '/member', label: 'Go to your membership', note: 'You are already a member.' };
  if (viewer && !viewer.trialEligible) return { to: '/join', label: 'Rejoin Crate Club', note: 'From $9.99 a month. Cancel anytime.' };
  return { to: '/join', label: 'Start your 30-day free trial', note: 'Then $9.99 a month. Cancel anytime.' };
}

function CallToAction() {
  const cta = useCallToAction();
  const prefetchJoin = usePrefetchJoin();
  return (
    <div className="hero__cta">
      <Link
        to={cta.to}
        className="button button--primary button--large"
        onMouseEnter={prefetchJoin}
        onFocus={prefetchJoin}
        onTouchStart={prefetchJoin}
      >
        {cta.label}
      </Link>
      <p className="hero__note">{cta.note}</p>
    </div>
  );
}

function PerksHero() {
  useExposure('landing_hero');
  return (
    <div className="hero__content" data-testid="hero" data-variant="control">
      <p className="eyebrow">Crate Club</p>
      <h1 id="hero-title">Free delivery from the shops on your block</h1>
      <p className="hero__lede">
        Groceries, flowers and hardware from neighborhood stores, at your door in under an hour. Members pay no delivery fee on
        orders over $20 and half the service fee on everything.
      </p>
      <CallToAction />
    </div>
  );
}

function SavingsHero() {
  useExposure('landing_hero');
  const [orders, setOrders] = useState(4);
  const sliderId = useId();
  const savings = monthlySavings(orders);
  return (
    <div className="hero__content" data-testid="hero" data-variant="savings_calculator">
      <p className="eyebrow">Crate Club</p>
      <h1 id="hero-title">Crate Club pays for itself in {breakEvenOrders()} orders a month</h1>
      <div className="calculator">
        <label htmlFor={sliderId}>
          How many orders a month? <strong>{orders}</strong>
        </label>
        <input
          id={sliderId}
          type="range"
          min={1}
          max={12}
          value={orders}
          onChange={(event) => {
            setOrders(Number(event.target.value));
          }}
        />
        <p className="calculator__result" aria-live="polite">
          {savings > 0 ? (
            <>
              You would save about <strong>{formatDollars(savings)}</strong> a month after the membership fee.
            </>
          ) : (
            <>At {orders === 1 ? 'one order' : `${String(orders)} orders`} a month, the fee costs more than it saves.</>
          )}
        </p>
      </div>
      <CallToAction />
    </div>
  );
}

function Hero() {
  const { data: variant, isError } = useAssignment('landing_hero');
  // A failed assignment falls back to the control without logging an exposure, so it never skews results.
  if (isError) {
    return (
      <div className="hero__content" data-testid="hero">
        <p className="eyebrow">Crate Club</p>
        <h1 id="hero-title">Free delivery from the shops on your block</h1>
        <CallToAction />
      </div>
    );
  }
  if (!variant) {
    return (
      <div className="hero__content hero__content--loading" aria-busy="true">
        <h1 id="hero-title" className="visually-hidden">
          Crate Club
        </h1>
        <div className="skeleton skeleton--title" />
        <div className="skeleton skeleton--text" />
        <div className="skeleton skeleton--button" />
      </div>
    );
  }
  return variant === 'savings_calculator' ? <SavingsHero /> : <PerksHero />;
}

const FAQ = [
  {
    q: 'When am I charged?',
    a: 'Monthly members get 30 days free on their first membership, then $9.99 a month. Annual members pay $79 when they join.',
  },
  { q: 'Can I cancel anytime?', a: 'Yes. Cancel from your membership page in two clicks. Your perks last until the end of the period you paid for.' },
  {
    q: 'What if a payment fails?',
    a: 'Your membership is marked past due and we try again. After three failed charges in a row it is cancelled.',
  },
  { q: 'Is this a real service?', a: 'No. Corner Crate is a fictional company in a demo app, and no real card is ever charged.' },
];

export function Landing() {
  const { data: plans } = usePlans();
  const monthly = plans?.find((plan) => plan.id === 'MONTHLY');
  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <div className="container hero__inner">
          <Hero />
          <div className="hero__art" aria-hidden="true">
            <div className="crate-stack">
              <span className="crate crate--1" />
              <span className="crate crate--2" />
              <span className="crate crate--3" />
            </div>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="perks-title">
        <div className="container">
          <h2 id="perks-title">What members get</h2>
          <Perks />
        </div>
      </section>

      <section className="section section--tinted" aria-labelledby="plans-title">
        <div className="container">
          <h2 id="plans-title">Two ways to join</h2>
          <ul className="plan-summary">
            {plans?.map((plan) => (
              <li key={plan.id} className="plan-summary__item">
                <h3>{plan.name}</h3>
                <p className="price">
                  {formatCents(plan.priceCents)}
                  <span> a {intervalLabel(plan)}</span>
                </p>
                <p>
                  {plan.trialDays > 0
                    ? `${String(plan.trialDays)} days free on your first membership.`
                    : monthly && `Save ${formatCents(monthly.priceCents * 12 - plan.priceCents)} a year compared with monthly.`}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section" aria-labelledby="faq-title">
        <div className="container narrow">
          <h2 id="faq-title">Questions</h2>
          {FAQ.map((item) => (
            <details key={item.q} className="faq">
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </section>
    </>
  );
}
