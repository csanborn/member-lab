# member-lab

A full stack TypeScript demo of a paid membership program. Crate Club is the membership for Corner Crate, a made-up neighborhood delivery service: visitors land on a page that is running an A/B test, join with a free trial or an annual plan, and can bill or cancel from their member page. Behind it is a GraphQL API that never charges twice, an experimentation layer written from scratch (hash bucketing, exposure logging, a z-test, confidence intervals and a sample ratio mismatch check), and Prometheus metrics with an alert rule. It is built with Node, GraphQL Yoga, SQLite, React 19, TanStack Query and TypeScript (strict).

![Experiment results page: the savings calculator wins with a significant lift, and the default plan test is flagged for a sample ratio mismatch](docs/screenshot.png)

Corner Crate, Crate Club, every price, perk and user are invented, and no real payment is ever made.

## Quickstart

```sh
npm install
npm run simulate   # optional: fills the database with 24,000 simulated visitors
npm run dev
```

Open http://localhost:5173. The API runs on port 4000 and Vite proxies `/graphql`, `/metrics` and `/healthz` to it. There are no keys and no database server: data lives in `data/member-lab.db`, a SQLite file. Run `npm run simulate` before starting the server, or restart the server after it.

| Page | What to try |
| --- | --- |
| `/` | The hero is one of two experiment variants. "Start over as a new visitor" in the footer gets a new id, which may land in the other one. |
| `/join` | Pick a plan and a demo card. Card B is always declined. Double clicking the button is safe. |
| `/member` | Status, history, demo billing controls (end the trial, renew, fail a payment) and cancel. |
| `/experiments` | Live results for both experiments, refreshed every 15 seconds. |

`npm run build && npm start` serves the built app and the API together on port 4000. GraphiQL is at `/graphql` in development.

| Variable | Default | Does |
| --- | --- | --- |
| `PORT` | `4000` | HTTP port |
| `DB_PATH` | `data/member-lab.db` | SQLite file, or `:memory:` |
| `LOG_LEVEL` | `info` | pino level |
| `PAYMENT_LATENCY_MS` | `150` | Fake provider latency |
| `PAYMENT_TRANSIENT_RATE` | `0` | Share of charges that time out before charging |
| `PAYMENT_LOST_RESPONSE_RATE` | `0` | Share of charges that succeed and then lose the response |

## How the experiment layer works

Experiments are declared in code (`shared/experiments.ts`): a key, a salt, variants with weights and the metric they are judged on. The rest lives in `server/experiments/`.

- **Bucketing is a pure function.** `hash32(salt:experiment:user) mod 10000` picks one of 10,000 buckets, and the variants' weights are laid end to end over them. The hash is FNV-1a followed by the MurmurHash3 finalizer: FNV-1a alone spreads ids like `user-1`, `user-2` poorly in its low bits, and the finalizer fixes that. Same user, same variant, with nothing stored. Changing the salt reshuffles everyone.
- **Assignment is not exposure.** The `assignment` query only computes the variant. The variant component calls `logExposure` from an effect, which runs only after it has rendered, so visitors who leave before the hero appears are never counted. The server recomputes the variant rather than trusting the client, and keeps only the first exposure per user.
- **Conversions are joined on the server.** Starting a membership writes a `membership_started` event. A conversion counts for an experiment only if it happened at or after that user's first exposure, in one SQL query.
- **The statistics** (`server/experiments/stats.ts`) are implemented directly and tested against reference values:
  - Wilson score interval for each variant's rate, which behaves at the low rates conversions usually have.
  - Pooled two-proportion z-test for the p-value, and an unpooled 95% interval for the lift.
  - Chi-square goodness of fit of exposures against the configured weights for the SRM check, flagged below p = 0.001.
  - Normal and chi-square tails both come from one regularized incomplete gamma function, so far-tail p-values keep their precision.
- **The results view** shows "collecting data" until each variant has 100 exposures, and an SRM warning overrides any verdict, because a broken split makes the comparison meaningless.

`npm run simulate` plays seeded visitors through the same services the API uses, on a simulated clock across 45 days. The savings calculator variant raises click-through, and preselecting the annual plan changes who finishes and what they pick. The simulator also plants a bug: 12% of exposures in one arm of `signup_default_plan` never reach the server. The SRM check catches it, which is the point: that experiment's apparent loss is not a result you should ship on.

## How the membership state machine works

`server/membership/state-machine.ts` is a transition table and a pure `transition(status, event)` function. It is the only thing that decides a new status, and every move is written to an append-only history.

| From | `CHARGE_SUCCEEDED` | `CHARGE_FAILED` | `GRACE_EXPIRED` | `CANCEL` |
| --- | --- | --- | --- | --- |
| `TRIAL` | `ACTIVE` | `PAST_DUE` | invalid | `CANCELLED` |
| `ACTIVE` | `ACTIVE` | `PAST_DUE` | invalid | `CANCELLED` |
| `PAST_DUE` | `ACTIVE` | `PAST_DUE` | `CANCELLED` | `CANCELLED` |
| `CANCELLED` | invalid | invalid | invalid | invalid |

A first monthly membership starts in `TRIAL` without a charge. Annual plans, and anyone who has had a trial, are charged at signup and start `ACTIVE`. The third failed charge in a row cancels the membership. A partial unique index allows one membership per user that is not cancelled.

### Never charging twice

- Every mutation takes an `idempotencyKey`. The web app creates one per user intent and reuses it for every retry of that intent, including TanStack Query's automatic retries, so a retry is always safe.
- `server/idempotency.ts` claims the key in SQLite, runs the work once, stores the result and replays it for any repeat with the same input. A different input with the same key is rejected. A repeat that arrives while the first is still running shares its result. If the work throws, the claim is released so the client can retry.
- Charges pass a provider key derived from the request key. If the provider charges and the response is lost, the service retries with the same provider key and gets the original charge back instead of a second one.
- A per-user lock stops two tabs with different keys from both charging. It is in-process because one process owns the database. Several instances would need a row lock or advisory lock in a shared database instead.
- Business outcomes (declined, already a member) come back as data in the payload, not as GraphQL errors, so they are replayed like any other result and do not count toward the error rate.

## Observability

- **Logs:** one JSON line per request with `requestId`, method, path, status, duration and GraphQL operation name. Domain events (charges, transitions, exposures) carry the same `requestId` through `AsyncLocalStorage`, and it is returned in `x-request-id`.
- **Metrics** at `/metrics`, in Prometheus format: `http_requests_total` and `http_request_duration_seconds` by route; `graphql_operations_total` (with an `outcome` label) and `graphql_operation_duration_seconds` by operation; `payment_charges_total`, `membership_transitions_total` and `experiment_exposures_total`; plus Node process metrics. A GraphQL error still answers HTTP 200, so the error rate is measured per operation, not per status code.
- **Health** at `/healthz` checks the database.

### Alert: GraphQLErrorRateHigh

Defined in [`ops/alerts.yml`](ops/alerts.yml). It fires when more than 2% of executed GraphQL operations fail for 10 minutes, with at least 0.2 operations per second so a quiet night does not page anyone. A unit test checks that the rule only names metrics and labels the server actually exports.

Runbook:

1. Find the failing operation: `sum by (operation) (rate(graphql_operations_total{outcome="error"}[5m]))`.
2. If it is `StartMembership` or `RunBilling`, check `rate(payment_charges_total{outcome="transient_error"}[5m])`. A spike means the payment provider is failing; the service already retries three times with the same key, so no one is double charged. Wait it out or fail over.
3. Otherwise, search the logs for `"msg":"unexpected GraphQL error"` and follow its `requestId` through the other lines of that request.
4. Check `/healthz`. A 503 means the database is unavailable.
5. Clients retry safely with the same idempotency key, so once the cause is fixed nothing needs replaying.

## Testing

```sh
npm run lint        # ESLint, strict type-checked rules, zero warnings allowed
npm run typecheck   # tsc, strict
npm test            # Vitest: unit, API and component tests
npm run build
npm run test:e2e    # Playwright, Chromium, against the built app on a fresh database
```

- **Unit:** every cell of the transition table; bucketing determinism, range and split (checked with the project's own chi-square); the stats functions against reference values; the idempotency store (replay, mismatched input, concurrent repeats, release on error, stale claims, restarts); the membership service under declines, transient failures, lost responses, double submits and racing tabs; exposure and conversion rules; the simulator's reproducibility.
- **API:** the real HTTP server on a random port, driven over `fetch`: signup, double submit, retry after a lost response (exactly one charge), cancel twice, billing, input errors, exposure before and after conversion, `/metrics`, `/healthz` and request ids.
- **Component:** the landing page logs an exposure only after a variant renders, once, under Strict Mode, and not at all when the assignment fails.
- **End to end:** a Playwright journey lands, sees a variant, signs up with a double click, closes the cancel dialog with Escape, cancels, and finds itself counted on the results page. Other journeys cover a declined card and starting over as a new visitor. Every page is checked with axe at WCAG 2.1 AA, and any console error fails the test.

CI runs all of it on every push and pull request, with no secrets. `npm run screenshot` refreshes the image above from a simulated database.

## Project layout

```
shared/        plan and experiment catalogs used by both sides
server/        HTTP app, GraphQL schema, services, SQLite repository, observability, simulator
src/           React app: pages, query hooks, exposure hook
e2e/           Playwright journeys
ops/           Prometheus alert rule
scripts/       traffic simulator entry point
```

## How this was built

I built member-lab by directing AI coding agents (Claude Code). The spec, [SPEC.md](SPEC.md), came first: goals, non-goals and acceptance criteria. The agents wrote the code and tests against it, and lint, typecheck, unit and API tests and a Playwright journey with accessibility checks gate every change.

## License

[MIT](LICENSE)
