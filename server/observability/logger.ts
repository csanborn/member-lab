import { pino, type Logger, type LevelWithSilent } from 'pino';

export type { Logger };

/** JSON lines on stdout, one object per event, easy to search and to ship to a log store. */
export function createLogger(level: LevelWithSilent = 'info'): Logger {
  return pino({
    level,
    base: { service: 'member-lab' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
  });
}
