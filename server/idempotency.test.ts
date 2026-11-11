import { describe, expect, it } from 'vitest';
import { ManualClock } from './clock.js';
import { SqliteRepository } from './db/sqlite-repository.js';
import { IdempotencyKeyReusedError, IdempotencyStore, KeyedMutex, RequestInProgressError, hashRequest } from './idempotency.js';

function setup() {
  const clock = new ManualClock(new Date('2026-10-01T00:00:00Z'));
  const repo = new SqliteRepository(':memory:');
  return { clock, repo, store: new IdempotencyStore(repo, clock) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('hashRequest', () => {
  it('ignores key order and undefined fields', () => {
    expect(hashRequest({ a: 1, b: [1, { c: 2, d: 3 }] })).toBe(hashRequest({ b: [1, { d: 3, c: 2 }], a: 1, e: undefined }));
    expect(hashRequest({ a: 1 })).not.toBe(hashRequest({ a: 2 }));
  });
});

describe('IdempotencyStore', () => {
  it('runs once and replays the stored result for the same key and input', async () => {
    const { store } = setup();
    let runs = 0;
    const work = () => Promise.resolve({ id: `result-${String((runs += 1))}` });
    const first = await store.run('scope', 'key-1', { plan: 'A' }, work);
    const second = await store.run('scope', 'key-1', { plan: 'A' }, work);
    expect(first).toEqual({ id: 'result-1' });
    expect(second).toEqual(first);
    expect(runs).toBe(1);
  });

  it('rejects the same key with different input', async () => {
    const { store } = setup();
    await store.run('scope', 'key-1', { plan: 'A' }, () => Promise.resolve('ok'));
    await expect(store.run('scope', 'key-1', { plan: 'B' }, () => Promise.resolve('other'))).rejects.toBeInstanceOf(
      IdempotencyKeyReusedError,
    );
  });

  it('keeps scopes apart', async () => {
    const { store } = setup();
    await store.run('user-a', 'key-1', {}, () => Promise.resolve('a'));
    expect(await store.run('user-b', 'key-1', {}, () => Promise.resolve('b'))).toBe('b');
  });

  it('shares one run between concurrent repeats', async () => {
    const { store } = setup();
    const gate = deferred<string>();
    let runs = 0;
    const work = () => {
      runs += 1;
      return gate.promise;
    };
    const first = store.run('scope', 'key-1', { n: 1 }, work);
    const second = store.run('scope', 'key-1', { n: 1 }, work);
    const mismatch = store.run('scope', 'key-1', { n: 2 }, work);
    gate.resolve('done');
    expect(await Promise.all([first, second])).toEqual(['done', 'done']);
    await expect(mismatch).rejects.toBeInstanceOf(IdempotencyKeyReusedError);
    expect(runs).toBe(1);
  });

  it('releases the key when the work throws, so a retry runs again', async () => {
    const { store, repo } = setup();
    await expect(store.run('scope', 'key-1', {}, () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(repo.findIdempotency('scope', 'key-1')).toBeUndefined();
    expect(await store.run('scope', 'key-1', {}, () => Promise.resolve('second try'))).toBe('second try');
  });

  it('refuses a fresh claim left by another process, and takes over a stale one', async () => {
    const { store, repo, clock } = setup();
    repo.claimIdempotency({ scope: 'scope', key: 'key-1', requestHash: hashRequest({}), createdAt: clock.now().toISOString() });
    await expect(store.run('scope', 'key-1', {}, () => Promise.resolve('x'))).rejects.toBeInstanceOf(RequestInProgressError);
    clock.advance(61_000);
    expect(await store.run('scope', 'key-1', {}, () => Promise.resolve('recovered'))).toBe('recovered');
  });

  it('survives a restart: a new store over the same database replays', async () => {
    const { store, repo, clock } = setup();
    await store.run('scope', 'key-1', {}, () => Promise.resolve({ value: 7 }));
    const restarted = new IdempotencyStore(repo, clock);
    expect(await restarted.run('scope', 'key-1', {}, () => Promise.resolve({ value: 8 }))).toEqual({ value: 7 });
  });
});

describe('KeyedMutex', () => {
  it('runs work for one key in order, and other keys in parallel', async () => {
    const mutex = new KeyedMutex();
    const log: string[] = [];
    const gate = deferred<undefined>();
    const a1 = mutex.run('a', async () => {
      log.push('a1 start');
      await gate.promise;
      log.push('a1 end');
    });
    const a2 = mutex.run('a', () => {
      log.push('a2');
      return Promise.resolve();
    });
    const b1 = mutex.run('b', () => {
      log.push('b1');
      return Promise.resolve();
    });
    await b1;
    expect(log).toEqual(['a1 start', 'b1']);
    gate.resolve(undefined);
    await Promise.all([a1, a2]);
    expect(log).toEqual(['a1 start', 'b1', 'a1 end', 'a2']);
  });

  it('keeps going after a failure', async () => {
    const mutex = new KeyedMutex();
    await expect(mutex.run('a', () => Promise.reject(new Error('first')))).rejects.toThrow('first');
    expect(await mutex.run('a', () => Promise.resolve('second'))).toBe('second');
  });
});
