import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue, type SQLOutputValue } from 'node:sqlite';
import type {
  ExposureRow,
  IdempotencyRow,
  MembershipHistoryRow,
  MembershipRow,
  Repository,
  VariantCounts,
} from './repository.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS memberships (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELLED')),
  payment_method TEXT NOT NULL,
  started_at TEXT NOT NULL,
  trial_ends_at TEXT,
  current_period_end TEXT NOT NULL,
  cancelled_at TEXT,
  failed_charge_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
-- At most one membership per user that is not cancelled.
CREATE UNIQUE INDEX IF NOT EXISTS memberships_one_live_per_user
  ON memberships (user_id) WHERE status != 'CANCELLED';
CREATE INDEX IF NOT EXISTS memberships_by_user ON memberships (user_id, started_at);

CREATE TABLE IF NOT EXISTS membership_history (
  id TEXT PRIMARY KEY,
  membership_id TEXT NOT NULL REFERENCES memberships (id),
  event TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  at TEXT NOT NULL,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS membership_history_by_membership ON membership_history (membership_id, at);

CREATE TABLE IF NOT EXISTS exposures (
  experiment_key TEXT NOT NULL,
  user_id TEXT NOT NULL,
  variant TEXT NOT NULL,
  first_exposed_at TEXT NOT NULL,
  PRIMARY KEY (experiment_key, user_id)
);

CREATE TABLE IF NOT EXISTS conversions (
  user_id TEXT NOT NULL,
  metric TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS conversions_by_user ON conversions (user_id, metric, at);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'complete')),
  response TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (scope, key)
);
`;

type Row = Record<string, SQLOutputValue>;
type Params = Record<string, SQLInputValue>;

function str(row: Row, column: string): string {
  const value = row[column];
  if (typeof value !== 'string') throw new Error(`Expected text in ${column}`);
  return value;
}

function strOrNull(row: Row, column: string): string | null {
  const value = row[column];
  return value === null || value === undefined ? null : str(row, column);
}

function num(row: Row, column: string): number {
  const value = row[column];
  if (typeof value !== 'number' && typeof value !== 'bigint') throw new Error(`Expected a number in ${column}`);
  return Number(value);
}

function toMembership(row: Row): MembershipRow {
  return {
    id: str(row, 'id'),
    userId: str(row, 'user_id'),
    planId: str(row, 'plan_id') as MembershipRow['planId'],
    status: str(row, 'status') as MembershipRow['status'],
    paymentMethod: str(row, 'payment_method') as MembershipRow['paymentMethod'],
    startedAt: str(row, 'started_at'),
    trialEndsAt: strOrNull(row, 'trial_ends_at'),
    currentPeriodEnd: str(row, 'current_period_end'),
    cancelledAt: strOrNull(row, 'cancelled_at'),
    failedChargeCount: num(row, 'failed_charge_count'),
    updatedAt: str(row, 'updated_at'),
  };
}

function toHistory(row: Row): MembershipHistoryRow {
  return {
    id: str(row, 'id'),
    membershipId: str(row, 'membership_id'),
    event: str(row, 'event') as MembershipHistoryRow['event'],
    fromStatus: strOrNull(row, 'from_status') as MembershipHistoryRow['fromStatus'],
    toStatus: str(row, 'to_status') as MembershipHistoryRow['toStatus'],
    at: str(row, 'at'),
    detail: strOrNull(row, 'detail'),
  };
}

function membershipParams(row: MembershipRow): Params {
  return {
    id: row.id,
    user_id: row.userId,
    plan_id: row.planId,
    status: row.status,
    payment_method: row.paymentMethod,
    started_at: row.startedAt,
    trial_ends_at: row.trialEndsAt,
    current_period_end: row.currentPeriodEnd,
    cancelled_at: row.cancelledAt,
    failed_charge_count: row.failedChargeCount,
    updated_at: row.updatedAt,
  };
}

/** SQLite through Node's built-in driver. Pass `:memory:` for a throwaway database. */
export class SqliteRepository implements Repository {
  readonly #db: DatabaseSync;
  #depth = 0;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.#db = new DatabaseSync(path);
    this.#db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 2000;');
    this.#db.exec(SCHEMA);
  }

  ping(): boolean {
    const row = this.#db.prepare('SELECT 1 AS ok').get();
    return row?.ok === 1;
  }

  /** Nested calls join the outer transaction. */
  transaction<T>(fn: () => T): T {
    if (this.#depth > 0) return fn();
    this.#db.exec('BEGIN IMMEDIATE');
    this.#depth += 1;
    try {
      const result = fn();
      this.#db.exec('COMMIT');
      return result;
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    } finally {
      this.#depth -= 1;
    }
  }

  close(): void {
    this.#db.close();
  }

  findLiveMembership(userId: string): MembershipRow | undefined {
    const row = this.#db.prepare("SELECT * FROM memberships WHERE user_id = ? AND status != 'CANCELLED'").get(userId);
    return row ? toMembership(row) : undefined;
  }

  findLatestMembership(userId: string): MembershipRow | undefined {
    const row = this.#db
      .prepare('SELECT * FROM memberships WHERE user_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1')
      .get(userId);
    return row ? toMembership(row) : undefined;
  }

  findMembership(id: string): MembershipRow | undefined {
    const row = this.#db.prepare('SELECT * FROM memberships WHERE id = ?').get(id);
    return row ? toMembership(row) : undefined;
  }

  hasHadTrial(userId: string): boolean {
    const row = this.#db
      .prepare('SELECT 1 AS found FROM memberships WHERE user_id = ? AND trial_ends_at IS NOT NULL LIMIT 1')
      .get(userId);
    return row !== undefined;
  }

  insertMembership(row: MembershipRow): void {
    this.#db
      .prepare(
        `INSERT INTO memberships (id, user_id, plan_id, status, payment_method, started_at, trial_ends_at,
           current_period_end, cancelled_at, failed_charge_count, updated_at)
         VALUES (:id, :user_id, :plan_id, :status, :payment_method, :started_at, :trial_ends_at,
           :current_period_end, :cancelled_at, :failed_charge_count, :updated_at)`,
      )
      .run(membershipParams(row));
  }

  updateMembership(row: MembershipRow): void {
    this.#db
      .prepare(
        `UPDATE memberships SET status = :status, payment_method = :payment_method, current_period_end = :current_period_end,
           cancelled_at = :cancelled_at, failed_charge_count = :failed_charge_count, updated_at = :updated_at
         WHERE id = :id`,
      )
      .run({
        id: row.id,
        status: row.status,
        payment_method: row.paymentMethod,
        current_period_end: row.currentPeriodEnd,
        cancelled_at: row.cancelledAt,
        failed_charge_count: row.failedChargeCount,
        updated_at: row.updatedAt,
      });
  }

  insertHistory(row: MembershipHistoryRow): void {
    this.#db
      .prepare(
        `INSERT INTO membership_history (id, membership_id, event, from_status, to_status, at, detail)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(row.id, row.membershipId, row.event, row.fromStatus, row.toStatus, row.at, row.detail);
  }

  listHistory(membershipId: string): MembershipHistoryRow[] {
    return this.#db
      .prepare('SELECT * FROM membership_history WHERE membership_id = ? ORDER BY at, rowid')
      .all(membershipId)
      .map(toHistory);
  }

  insertExposure(row: ExposureRow): boolean {
    const result = this.#db
      .prepare(
        `INSERT INTO exposures (experiment_key, user_id, variant, first_exposed_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (experiment_key, user_id) DO NOTHING`,
      )
      .run(row.experimentKey, row.userId, row.variant, row.firstExposedAt);
    return Number(result.changes) === 1;
  }

  insertConversion(conversion: { userId: string; metric: string; at: string }): void {
    this.#db
      .prepare('INSERT INTO conversions (user_id, metric, at) VALUES (?, ?, ?)')
      .run(conversion.userId, conversion.metric, conversion.at);
  }

  countVariantResults(experimentKey: string, metric: string): VariantCounts[] {
    return this.#db
      .prepare(
        `SELECT e.variant AS variant,
           COUNT(*) AS exposures,
           SUM(EXISTS (
             SELECT 1 FROM conversions c
             WHERE c.user_id = e.user_id AND c.metric = :metric AND c.at >= e.first_exposed_at
           )) AS conversions
         FROM exposures e
         WHERE e.experiment_key = :experiment_key
         GROUP BY e.variant`,
      )
      .all({ metric, experiment_key: experimentKey })
      .map((row) => ({ variant: str(row, 'variant'), exposures: num(row, 'exposures'), conversions: num(row, 'conversions') }));
  }

  findIdempotency(scope: string, key: string): IdempotencyRow | undefined {
    const row = this.#db.prepare('SELECT * FROM idempotency_keys WHERE scope = ? AND key = ?').get(scope, key);
    if (!row) return undefined;
    return {
      scope: str(row, 'scope'),
      key: str(row, 'key'),
      requestHash: str(row, 'request_hash'),
      state: str(row, 'state') as IdempotencyRow['state'],
      response: strOrNull(row, 'response'),
      createdAt: str(row, 'created_at'),
    };
  }

  claimIdempotency(row: Omit<IdempotencyRow, 'state' | 'response'>): boolean {
    const result = this.#db
      .prepare(
        `INSERT INTO idempotency_keys (scope, key, request_hash, state, created_at) VALUES (?, ?, ?, 'pending', ?)
         ON CONFLICT (scope, key) DO NOTHING`,
      )
      .run(row.scope, row.key, row.requestHash, row.createdAt);
    return Number(result.changes) === 1;
  }

  completeIdempotency(scope: string, key: string, response: string): void {
    this.#db
      .prepare("UPDATE idempotency_keys SET state = 'complete', response = ? WHERE scope = ? AND key = ?")
      .run(response, scope, key);
  }

  releaseIdempotency(scope: string, key: string): void {
    this.#db.prepare("DELETE FROM idempotency_keys WHERE scope = ? AND key = ? AND state = 'pending'").run(scope, key);
  }
}
