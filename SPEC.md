# member-lab spec

A full stack TypeScript demo of a paid membership program, "Crate Club", for a fictional neighborhood delivery service called Corner Crate. It exists to show the work behind a membership product: signup and conversion flows, an experimentation layer built from first principles, APIs that stay correct under retries and failures, and the tests and monitoring that keep all of it honest.

Corner Crate, Crate Club and every price, perk and user in this repo are invented.

## Goals

- **Membership lifecycle.** A visitor can join, see their membership and cancel. Status follows an explicit state machine: `trial`, `active`, `past_due`, `cancelled`.
- **Money is never double counted.** Signup, billing and cancel take an idempotency key. Retries, double clicks and a payment response lost in transit never create a second membership or a second charge.
- **Experiments.** Users are bucketed by a deterministic hash. An exposure is logged only when a variant is actually rendered. Conversions are joined to exposures on the server. A results view reports conversion rate per variant, lift with a confidence interval, a two-proportion z-test and a sample ratio mismatch (SRM) check.
- **Believable data.** A seeded traffic simulator fills the experiments and memberships with data that looks like a real two-week test, through the same services the API uses.
- **Observability.** Structured JSON logs with a request id, a Prometheus `/metrics` endpoint with request rate, error rate and latency, and one alert rule with a runbook.
- **Runs anywhere.** `npm install && npm run dev` works with no keys, no accounts and no database server.

## Non-goals

- Real payments, real authentication or real users. Identity is an anonymous visitor id kept in the browser and sent as a header.
- A production deployment, a feature flag service or a third-party experimentation SDK.
- Multi-instance concurrency. One Node process owns the SQLite file. The idempotency design notes what a shared store would need.
- Imitating any real delivery service, membership program or brand: no real names, logos, colors, layouts or copy.

## Stack

- Server: Node 22 and TypeScript, GraphQL Yoga over `node:http`, SQLite through `node:sqlite` behind a small repository interface, `prom-client`, `pino`.
- Web: React 19, TypeScript, TanStack Query, React Router, Vite. Plain CSS with design tokens.
- Tests: Vitest (unit, API, component), Playwright with axe for the journey and accessibility.

## Membership

### Plans

| Plan | Price | Trial |
| --- | --- | --- |
| Monthly | $9.99 a month | 30 days free, first membership only |
| Annual | $79 a year | None, charged at signup |

### State machine

A pure function `transition(status, event)` returns the next status or an `InvalidTransition` error. Nothing else writes a status.

| From | `CHARGE_SUCCEEDED` | `CHARGE_FAILED` | `GRACE_EXPIRED` | `CANCEL` |
| --- | --- | --- | --- | --- |
| `trial` | `active` | `past_due` | invalid | `cancelled` |
| `active` | `active` | `past_due` | invalid | `cancelled` |
| `past_due` | `active` | `past_due` | `cancelled` | `cancelled` |
| `cancelled` | invalid | invalid | invalid | invalid |

- A monthly signup that is trial eligible starts in `trial` with no charge. Any other signup charges first and starts `active` only if the charge succeeds. A declined signup creates no membership.
- Every transition is written to an append-only event log with from, to, event and time.
- Billing (end of trial, renewal, retry) is triggered on demand by a demo control, since the demo has no scheduler. The third failed charge in a row while `past_due` applies `GRACE_EXPIRED`.
- At most one membership per user is not `cancelled`, enforced by a partial unique index as well as in code.

### Idempotency

- `startMembership`, `cancelMembership` and `runBilling` require a client generated `idempotencyKey`. The web app makes one key per user intent and reuses it on every retry of that intent.
- The first request with a key claims it. A repeat with the same key and the same input returns the stored result without running again. The same key with different input is rejected with `IDEMPOTENCY_KEY_REUSED`. A repeat that arrives while the first is still running shares the first one's result.
- Business outcomes (success, declined, not a member) are stored and replayed. Unexpected errors release the key so the client can retry.
- Every charge passes an idempotency key to the payment provider, derived from the request key, so a retry after a lost response returns the original charge instead of making a second one.

### Fake payment provider

- In memory, with a ledger of charges keyed by idempotency key.
- Demo payment methods: a card that succeeds and a card that declines.
- Injectable failures: decline, transient error before charging, and lost response (charge recorded, then the call fails). Optional latency.
- The membership service retries transient provider failures with backoff, reusing the same provider key.

## Experiments

- Config lives in code: key, description, variants with weights, primary metric, and a salt.
- **Bucketing:** `bucket = fnv1a32(salt + ":" + experimentKey + ":" + userId) mod 10000`, mapped onto cumulative variant weights. Same input, same variant, always. The split is close to the weights over many users.
- **Assignment** (`assignment` query) is a pure read and logs nothing.
- **Exposure** (`logExposure` mutation) is called by the variant component after it renders. The server recomputes the variant (it never trusts the client's), and records the first exposure per user per experiment.
- **Conversion:** starting a membership records a `membership_started` event. A conversion counts for an experiment only if it happened at or after that user's first exposure.
- **Results** per variant: exposed users, converted users, rate with a 95% Wilson interval, absolute and relative lift against control with a 95% interval on the difference, and a two-sided two-proportion z-test p-value. An SRM chi-square test compares exposures to the configured weights and flags p below 0.001. Fewer than 100 exposures in any variant is shown as "collecting data", not as a result.
- Two experiments: `landing_hero` (control headline vs a savings calculator) and `signup_default_plan` (monthly vs annual preselected).

### Simulator

- `npm run simulate` writes a seeded, reproducible run into the local database through the real services, with a simulated clock across 14 days.
- Visitors land, some leave before a variant renders, some convert at a rate that depends on their variant, some pick annual, some decline, some trials renew, fail or cancel.
- It deliberately drops a small share of exposures in one arm of `signup_default_plan` to show the SRM check catching a broken logging path.

## Web

- `/`: landing page. The hero is the `landing_hero` variant. Perks, plan prices, FAQ, and a call to action.
- `/join`: plan choice (default plan from `signup_default_plan`), demo payment method, submit. Declines are announced. Double submit is harmless.
- `/member`: status, plan, dates, perks, the event history, demo billing controls, and cancel with a confirmation dialog.
- `/experiments`: results for each experiment with an interval chart and a plain language verdict.
- Visitor controls: show the visitor id and start over as a new visitor.
- Data fetching through TanStack Query: queries keyed by visitor, mutations update the cache from their payload, retries reuse the idempotency key.
- WCAG 2.1 AA: semantic landmarks, labeled controls, visible focus, 4.5:1 text contrast, keyboard operable dialog, live regions for async results, `prefers-reduced-motion` respected.

## Observability

- Logs: one JSON line per request with request id, method, path, status, duration and GraphQL operation name. Domain events (membership transitions, charges, exposures) log with the same request id. The request id is returned in `x-request-id`.
- `/metrics` (Prometheus text): `http_requests_total`, `http_request_duration_seconds`, `graphql_operations_total` with an `outcome` label, `graphql_operation_duration_seconds`, `payment_charges_total`, `membership_transitions_total`, `experiment_exposures_total`, plus Node process metrics.
- `/healthz` returns 200 when the database answers.
- `ops/alerts.yml`: one Prometheus rule, `GraphQLErrorRateHigh`, with a runbook in the README.

## Acceptance criteria

1. `npm install && npm run dev` serves the app and API with no keys; `npm run simulate` fills the results page.
2. `npm run lint` (0 warnings), `npm run typecheck`, `npm test`, `npm run build` and `npm run test:e2e` pass locally and in GitHub Actions with no secrets.
3. Unit tests cover every cell of the transition table, bucketing determinism and split, the stats functions against known values, the idempotency store (replay, mismatch, concurrent repeat, release on error), and the membership service under declines, transient failures and lost responses.
4. API tests drive the real HTTP server: signup, double submit, retry after a lost response (exactly one charge), cancel twice, exposure before and after conversion, results, `/metrics` and `/healthz`.
5. A component test shows an exposure is logged only after a variant renders, and once.
6. A Playwright journey lands, sees a variant, signs up, cancels and finds itself counted on the results page, with no console errors and no axe violations at WCAG 2.1 AA on each page.
7. The README explains the experiment layer, the state machine, idempotency, the alert and how the project was built, with a screenshot.
