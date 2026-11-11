import { pino, type Logger, type LevelWithSilent } from 'pino';
import { requestContext } from './request-context.js';

export type { Logger };

/** JSON lines on stdout. Any line written while handling a request carries its `requestId`. */
export function createLogger(level: LevelWithSilent = 'info'): Logger {
  return pino({
    level,
    base: { service: 'member-lab' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    mixin: () => {
      const context = requestContext.getStore();
      return context ? { requestId: context.requestId } : {};
    },
  });
}
