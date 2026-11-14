/** Anything with these four methods works: console, pino, winston... */
export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

const noop = (): void => undefined;

/** The default logger: warnings and errors to the console, nothing else. */
export const consoleLogger: Logger = {
  debug: noop,
  info: noop,
  warn: (message, data) => {
    console.warn(`[shoehive] ${message}`, data ?? '');
  },
  error: (message, data) => {
    console.error(`[shoehive] ${message}`, data ?? '');
  },
};

/** A logger that discards everything (tests). */
export const silentLogger: Logger = { debug: noop, info: noop, warn: noop, error: noop };
