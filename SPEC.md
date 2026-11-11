# member-lab spec

A front-end project for a paid membership program, "Crate Club", for a fictional neighborhood delivery service called Corner Crate. It exists to show front-end product engineering on a membership: conversion flows, A/B test variants rendered in the browser with correct exposure logging, an experiment results page that is honest about its statistics, and the state management, performance and accessibility work behind them. A deliberately small API supports it.

Corner Crate, Crate Club and every price, perk and user in this repo are invented.

## Goals

- **Front end first.** Most of the effort goes into the React app: flows, data fetching, experiment rendering, charts, performance and accessibility.
- **Membership flows.** A visitor can join, see their membership, run demo billing and cancel. Status follows a small state machine: `TRIAL`, `ACTIVE`, `PAST_DUE`, `CANCELLED`.
- **Correct experiments in the browser.** Variants are rendered client side. An exposure is logged only after a variant has rendered. The results page reports conversion rate per variant with intervals, lift with an interval, a p-value, a sample ratio mismatch (SRM) warning and a daily trend.
- **Money is never double counted.** Signup, billing and cancel take an idempotency key from the browser, so retries and double clicks run once.
- **Measured performance.** Route-level code splitting, a gzipped bundle budget enforced in CI, and Core Web Vitals reported from real page loads.
- **Runs anywhere.** `npm install && npm run dev` works with no keys, accounts or database, and the results page already has data.

## Non-goals

- Backend depth: no database tuning, queues, sharding, multi-instance coordination or schedulers. The API is in-memory and resets on restart.
- Real payments, real authentication or real users. Identity is an anonymous visitor id kept in the browser and sent as a header.
- A feature flag service or third-party experimentation SDK.
- Imitating any real delivery service, membership program or brand: no real names, logos, colors, layouts or copy.

## Stack

- Web: React 19, TypeScript, TanStack Query, React Router, Vite, plain CSS with design tokens, `web-vitals`.
- API: Node 22 and TypeScript, GraphQL Yoga over `node:http`, an in-memory repository behind a small interface, `pino`, `prom-client`.
- Tests: Vitest (unit, component with Testing Library, API), Playwright with axe.

## Web app

### Pages

- `/`: landing page. The hero is the `landing_hero` variant: a perks headline (control) or a savings calculator. Perks, plan prices, FAQ, call to action.
- `/join`: plan choice (default plan from `signup_default_plan`), demo payment method, submit. Declines are announced. Double submit is harmless.
- `/member`: status, plan, dates, perks, history, demo billing controls, and cancel with a confirmation dialog.
- `/experiments`: per experiment a verdict, a results table, an interval chart and a cumulative trend chart; then a Web Vitals panel.

### Data and state

- All server state goes through TanStack Query. Query keys include the visitor id. Plans and assignments are cached for the visit. Results poll every 15 seconds.
- Hovering or focusing the call to action prefetches the signup form's data.
- Mutations retry only transient failures (network, 5xx), reusing the same idempotency key.
- Cancel is optimistic with rollback and an error message. Signup and billing wait for the server.
- A render error in a page shows a recoverable error view instead of a blank app.

### Experiments in the browser

- `assignment` is a pure read. The variant component calls `logExposure` from an effect after it renders, once per visitor per experiment per page load. The server recomputes the variant and keeps only the first exposure.
- A failed assignment falls back to the control copy without logging an exposure.

### Performance

- The member and results pages are lazy-loaded chunks, preloaded on hover or focus of their links.
- `npm run budget` fails if the entry script exceeds 110 KB gzipped, the CSS 8 KB, or any lazy chunk 30 KB.
- LCP, INP, CLS, FCP and TTFB are sent with `sendBeacon` to `/vitals`. The results page shows the 75th percentile of recent samples, rated against Google's thresholds.

### Accessibility (WCAG 2.1 AA)

- Semantic landmarks and headings, labeled controls, visible focus, 4.5:1 text contrast.
- Native `<dialog>` for confirmation. Focus moves to the main region on navigation and to the heading after cancelling.
- Live regions for async results. Charts have a text summary and a data table.
- `prefers-reduced-motion` respected.

## Experiments

- Config in code: key, description, a control and one treatment with weights, metric, salt.
- **Bucketing:** `hash32(salt + ":" + experimentKey + ":" + userId) mod 10000`, where `hash32` is FNV-1a with the MurmurHash3 finalizer, mapped onto the weights.
- **Conversion:** starting a membership records `membership_started`. It counts only if at or after the visitor's first exposure.
- **Statistics** (small pure modules with unit tests): Wilson 95% interval per rate; two-proportion z-test (pooled) for the p-value and an unpooled 95% interval on the lift; SRM as a one-proportion z-test on the control's share of exposures, flagged below p = 0.001. Normal tail probabilities use the Abramowitz and Stegun erf approximation.
- Under 100 exposures in either arm the result is "collecting". An SRM overrides any verdict.
- A daily series (new exposures and conversions per variant per day) feeds the cumulative trend chart.
- **Simulator:** on startup the API plays 24,000 seeded visitors through the real services over a simulated 45 days ending now. It plants a bug that drops 12% of exposures in one arm of `signup_default_plan`, so the SRM warning has something to catch.

## API

- GraphQL: `viewer`, `plans`, `assignment`, `experiments` (with results and daily series), `webVitals`; mutations `logExposure`, `startMembership`, `cancelMembership`, `runBilling`.
- Business outcomes (declined, already a member, not a member, key reused) are returned as data, not GraphQL errors.

### Membership state machine

| From | `CHARGE_SUCCEEDED` | `CHARGE_FAILED` | `GRACE_EXPIRED` | `CANCEL` |
| --- | --- | --- | --- | --- |
| `TRIAL` | `ACTIVE` | `PAST_DUE` | invalid | `CANCELLED` |
| `ACTIVE` | `ACTIVE` | `PAST_DUE` | invalid | `CANCELLED` |
| `PAST_DUE` | `ACTIVE` | `PAST_DUE` | `CANCELLED` | `CANCELLED` |
| `CANCELLED` | invalid | invalid | invalid | invalid |

- A first monthly membership starts in `TRIAL` with no charge. Annual plans and rejoining members are charged at signup and start `ACTIVE` only if the charge succeeds.
- The third failed charge in a row applies `GRACE_EXPIRED`.

### Idempotency

- The first request with a key runs. A repeat with the same input gets the same result, including one that arrives while the first is still running. The same key with different input is rejected. A thrown error forgets the key so the client can retry.
- Each charge passes a provider key derived from the request key, so a retry after a lost response returns the original charge.
- One membership change per user at a time, so two tabs with different keys cannot both charge.

### Fake payment provider

- In memory, with a ledger keyed by idempotency key. A card that succeeds and a card that declines. Injectable decline, transient error and lost response. The service retries transient errors with backoff.

## Monitoring

- One JSON log line per request with a request id, returned in `x-request-id`.
- `/metrics` (Prometheus): `http_requests_total`, `http_request_duration_seconds`, `graphql_operations_total` with an `outcome` label, `graphql_operation_duration_seconds`, `payment_charges_total`, plus process metrics.
- `ops/alerts.yml`: `GraphQLErrorRateHigh`, documented in the README.

## Acceptance criteria

1. `npm install && npm run dev` serves the app and API with no keys, and `/experiments` shows seeded results.
2. `npm run lint` (0 warnings), `npm run typecheck`, `npm test`, `npm run build`, `npm run budget` and `npm run test:e2e` pass locally and in GitHub Actions with no secrets.
3. Component tests show an exposure is logged only after a variant renders, once, and that an optimistic cancel rolls back with a message when the server refuses.
4. Unit tests cover bucketing, the stats against reference values, the cumulative series, every cell of the transition table, idempotency and the membership service under declines and lost responses.
5. API tests drive the real HTTP server: signup, double submit, retry after a lost response (exactly one charge), cancel twice, exposure before and after conversion, Web Vitals beacons and `/metrics`.
6. A Playwright journey lands, sees a variant, signs up, cancels and finds itself counted on the results page, with no console errors and no axe violations at WCAG 2.1 AA on each page.
7. The README frames the project as front end with a minimal API, has a Walkthrough of the key decisions in plain language, and a screenshot.
