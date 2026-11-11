import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'member-lab:visitor-id';
const listeners = new Set<() => void>();

function readOrCreate(): string {
  const existing = localStorage.getItem(STORAGE_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(STORAGE_KEY, id);
  return id;
}

let current: string | undefined;

/** The anonymous id this browser uses as its identity. The demo has no sign-in. */
export function getVisitorId(): string {
  current ??= readOrCreate();
  return current;
}

/** Starts over as a brand-new visitor, who may land in different experiment variants. */
export function resetVisitor(): void {
  current = crypto.randomUUID();
  localStorage.setItem(STORAGE_KEY, current);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useVisitorId(): string {
  return useSyncExternalStore(subscribe, getVisitorId);
}
