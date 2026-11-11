import { describe, expect, it } from 'vitest';
import { IdempotencyKeyReusedError, IdempotencyStore, KeyedMutex, hashRequest } from './idempotency.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('hashRequest', () => {
  it('ignores key order and undefined fields', () => {
    expect(hashRequest({ a: 1, b: [1, { c: 2, d: 3 }] })).toBe(hashRequest({ b: [1, { d: 3, c: 2 }], a: 1, e: undefined }));
    expect(hashRequest({ a: 1 })).not.toBe(hashRequest({ a: 2 }));
  });
});

describe('IdempotencyStore', () => {
  it('runs once and replays the result for the same key and input', async () => {
    const store = new IdempotencyStore();
    let runs = 0;
    const work = () => Promise.resolve({ id: `result-${String((runs += 1))}` });
    const first = await store.run('scope', 'key-1', { plan: 'A' }, work);
    const second = await store.run('scope', 'key-1', { plan: 'A' }, work);
    expect(first).toEqual({ id: 'result-1' });
    expect(second).toBe(first);
    expect(runs).toBe(1);
  });

  it('rejects the same key with different input', async () => {
    const store = new IdempotencyStore();
    await store.run('scope', 'key-1', { plan: 'A' }, () => Promise.resolve('ok'));
    await expect(store.run('scope', 'key-1', { plan: 'B' }, () => Promise.resolve('other'))).rejects.toBeInstanceOf(
      IdempotencyKeyReusedError,
    );
  });

  it('keeps scopes apart', async () => {
    const store = new IdempotencyStore();
    await store.run('user-a', 'key-1', {}, () => Promise.resolve('a'));
    expect(await store.run('user-b', 'key-1', {}, () => Promise.resolve('b'))).toBe('b');
  });

  it('shares one run between concurrent repeats', async () => {
    const store = new IdempotencyStore();
    const gate = deferred<string>();
    let runs = 0;
    const work = () => {
      runs += 1;
      return gate.promise;
    };
    const first = store.run('scope', 'key-1', { n: 1 }, work);
    const second = store.run('scope', 'key-1', { n: 1 }, work);
    gate.resolve('done');
    expect(await Promise.all([first, second])).toEqual(['done', 'done']);
    expect(runs).toBe(1);
  });

  it('forgets the key when the work throws, so a retry runs again', async () => {
    const store = new IdempotencyStore();
    await expect(store.run('scope', 'key-1', {}, () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(await store.run('scope', 'key-1', {}, () => Promise.resolve('second try'))).toBe('second try');
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
    await mutex.run('b', () => {
      log.push('b1');
      return Promise.resolve();
    });
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
