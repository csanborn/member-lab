export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** A clock that only moves when told to. Used by tests and the traffic simulator. */
export class ManualClock implements Clock {
  #now: Date;

  constructor(start: Date) {
    this.#now = new Date(start);
  }

  now(): Date {
    return new Date(this.#now);
  }

  set(at: Date): void {
    this.#now = new Date(at);
  }

  advance(ms: number): void {
    this.#now = new Date(this.#now.getTime() + ms);
  }
}

export const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(at: Date, days: number): Date {
  return new Date(at.getTime() + days * DAY_MS);
}
