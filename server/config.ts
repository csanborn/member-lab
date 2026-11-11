import type { LevelWithSilent } from 'pino';

export interface Config {
  port: number;
  logLevel: LevelWithSilent;
  staticDir: string;
  dev: boolean;
  /** Simulated visitors loaded at startup so the results page has data. 0 starts empty. */
  seedVisitors: number;
  payment: { latencyMs: number; transientRate: number; lostResponseRate: number };
}

function number(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number, got "${raw}"`);
  return value;
}

const LEVELS = new Set(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);

export function loadConfig(): Config {
  const logLevel = process.env.LOG_LEVEL || 'info';
  if (!LEVELS.has(logLevel)) throw new Error(`LOG_LEVEL must be one of ${[...LEVELS].join(', ')}`);
  return {
    port: number('PORT', 4000),
    logLevel: logLevel as LevelWithSilent,
    staticDir: process.env.STATIC_DIR || 'dist/web',
    dev: process.env.NODE_ENV !== 'production',
    seedVisitors: number('SEED_VISITORS', 24_000),
    payment: {
      latencyMs: number('PAYMENT_LATENCY_MS', 150),
      transientRate: number('PAYMENT_TRANSIENT_RATE', 0),
      lostResponseRate: number('PAYMENT_LOST_RESPONSE_RATE', 0),
    },
  };
}
