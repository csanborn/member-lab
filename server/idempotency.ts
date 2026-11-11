import { createHash } from 'node:crypto';

export class IdempotencyKeyReusedError extends Error {
  constructor() {
    super('This idempotency key was already used for a different request');
    this.name = 'IdempotencyKeyReusedError';
  }
}

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

/**
 * Runs an operation at most once per (scope, key) and remembers its result.
 *
 * - The first call runs the operation and stores the promise of its result.
 * - A repeat with the same input gets that same promise: the stored result if it has finished,
 *   or a share of the running one if it has not. A double click therefore runs once.
 * - The same key with different input is rejected, since it is almost always a client bug.
 * - If the operation throws, the key is forgotten so the client can retry.
 *
 * Keys live in memory for the life of the process. A real service would keep them in its
 * database with an expiry, so they survive restarts and are shared between instances.
 */
export class IdempotencyStore {
  readonly #entries = new Map<string, { requestHash: string; result: Promise<unknown> }>();

  run<T>(scope: string, key: string, input: unknown, operation: () => Promise<T>): Promise<T> {
    const id = `${scope}\u0000${key}`;
    const requestHash = hashRequest(input);
    const existing = this.#entries.get(id);
    if (existing) {
      if (existing.requestHash !== requestHash) return Promise.reject(new IdempotencyKeyReusedError());
      return existing.result as Promise<T>;
    }

    const result = operation();
    this.#entries.set(id, { requestHash, result });
    void result.catch(() => this.#entries.delete(id));
    return result;
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
