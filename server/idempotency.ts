import { createHash } from 'node:crypto';
import type { Clock } from './clock.js';
import type { Repository } from './db/repository.js';

export class IdempotencyKeyReusedError extends Error {
  constructor() {
    super('This idempotency key was already used for a different request');
    this.name = 'IdempotencyKeyReusedError';
  }
}

export class RequestInProgressError extends Error {
  constructor() {
    super('A request with this idempotency key is still running');
    this.name = 'RequestInProgressError';
  }
}

/** A claim older than this with no live request behind it is from a crashed process and may be taken over. */
const STALE_CLAIM_MS = 60_000;

/** JSON with sorted object keys, so equal inputs always hash the same. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashRequest(input: unknown): string {
  return createHash('sha256').update(stableStringify(input)).digest('hex');
}

interface InFlight {
  requestHash: string;
  promise: Promise<unknown>;
}

/**
 * Runs an operation at most once per (scope, key).
 *
 * - First call claims the key, runs, and stores the JSON result.
 * - A repeat with the same input gets the stored result. With different input it is rejected.
 * - A repeat that arrives while the first is still running waits for and shares its result.
 * - If the operation throws, the claim is released so the caller can retry.
 *
 * Results must survive a JSON round trip. Callers decide what counts as a result (stored and
 * replayed) and what counts as an error (released and retryable).
 */
export class IdempotencyStore {
  readonly #repo: Repository;
  readonly #clock: Clock;
  readonly #inFlight = new Map<string, InFlight>();

  constructor(repo: Repository, clock: Clock) {
    this.#repo = repo;
    this.#clock = clock;
  }

  async run<T>(scope: string, key: string, input: unknown, operation: () => Promise<T>): Promise<T> {
    const requestHash = hashRequest(input);
    const id = `${scope}\u0000${key}`;

    const running = this.#inFlight.get(id);
    if (running) {
      if (running.requestHash !== requestHash) throw new IdempotencyKeyReusedError();
      return running.promise as Promise<T>;
    }

    const existing = this.#repo.findIdempotency(scope, key);
    if (existing) {
      if (existing.requestHash !== requestHash) throw new IdempotencyKeyReusedError();
      if (existing.state === 'complete' && existing.response !== null) return JSON.parse(existing.response) as T;
      const age = this.#clock.now().getTime() - Date.parse(existing.createdAt);
      if (age < STALE_CLAIM_MS) throw new RequestInProgressError();
      this.#repo.releaseIdempotency(scope, key);
    }

    if (!this.#repo.claimIdempotency({ scope, key, requestHash, createdAt: this.#clock.now().toISOString() })) {
      throw new RequestInProgressError();
    }

    const promise = operation().then(
      (result) => {
        this.#repo.completeIdempotency(scope, key, JSON.stringify(result));
        return result;
      },
      (error: unknown) => {
        this.#repo.releaseIdempotency(scope, key);
        throw error;
      },
    );
    this.#inFlight.set(id, { requestHash, promise });
    try {
      return await promise;
    } finally {
      this.#inFlight.delete(id);
    }
  }
}

/** Serializes async work per key, so one user's membership changes never interleave. */
export class KeyedMutex {
  readonly #tails = new Map<string, Promise<unknown>>();

  async run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(key) ?? Promise.resolve();
    const next = previous.then(work, work);
    const tail = next.catch(() => undefined);
    this.#tails.set(key, tail);
    try {
      return await next;
    } finally {
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    }
  }
}
