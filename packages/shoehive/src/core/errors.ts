import type { Json } from './json';

/** Error codes defined by Shoehive itself (docs/reference/protocol.md section 7). */
export const BUILTIN_ERROR_CODES = [
  'BAD_REQUEST',
  'UNSUPPORTED_PROTOCOL',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'INVALID_OPTIONS',
  'INVALID_INPUT',
  'NOT_JOINED',
  'TABLE_FULL',
  'SEAT_TAKEN',
  'ALREADY_SEATED',
  'NOT_SEATED',
  'NOT_STARTED',
  'ACTION_NOT_ALLOWED',
  'ALREADY_SUBMITTED',
  'NOT_PARTICIPANT',
  'ROUND_CLOSED',
  'STALE_REVISION',
  'TABLE_ENDED',
  'TABLE_UNAVAILABLE',
  'RATE_LIMITED',
  'TIMEOUT',
  'WALLET_UNAVAILABLE',
  'INTERNAL',
] as const;

export type BuiltinErrorCode = (typeof BUILTIN_ERROR_CODES)[number];

const BUILTIN_SET: ReadonlySet<string> = new Set(BUILTIN_ERROR_CODES);
const GAME_CODE = /^[A-Z][A-Z0-9_]*$/;

/** True when `code` is reserved by Shoehive and cannot be used with `reject()`. */
export function isBuiltinErrorCode(code: string): code is BuiltinErrorCode {
  return BUILTIN_SET.has(code);
}

/** Game codes must be SCREAMING_SNAKE_CASE and must not reuse a built-in code. */
export type GameErrorCode<C extends string> = C extends BuiltinErrorCode ? never : C;

/**
 * The one error type Shoehive raises and sends to clients. `source` tells apart codes
 * raised by Shoehive from codes a game raised with `reject()`.
 */
export class ShoehiveError extends Error {
  override readonly name = 'ShoehiveError';
  readonly code: string;
  readonly source: 'shoehive' | 'game';
  readonly details: Json | undefined;

  constructor(options: {
    code: string;
    source?: 'shoehive' | 'game';
    message?: string | undefined;
    details?: Json | undefined;
    cause?: unknown;
  }) {
    super(options.message ?? defaultMessage(options.code, options.source ?? 'shoehive'), {
      cause: options.cause,
    });
    this.code = options.code;
    this.source = options.source ?? 'shoehive';
    this.details = options.details;
  }

  /** The wire shape of this error (protocol section 7). */
  toJSON(): { code: string; source: 'shoehive' | 'game'; message: string; details?: Json } {
    return this.details === undefined
      ? { code: this.code, source: this.source, message: this.message }
      : { code: this.code, source: this.source, message: this.message, details: this.details };
  }
}

function defaultMessage(code: string, source: 'shoehive' | 'game'): string {
  return source === 'game' ? `Rejected by game: ${code}` : code;
}

/** Creates a Shoehive-sourced error. Internal helper. */
export function shoehiveError(
  code: BuiltinErrorCode,
  message?: string,
  details?: Json,
): ShoehiveError {
  return new ShoehiveError({ code, source: 'shoehive', message, details });
}

/**
 * Rejects the current action or hook. The whole entry rolls back and the client
 * receives the code (ADR 0001 rule 6).
 *
 * ```ts
 * if (ctx.turn.seat !== seat) reject('NOT_YOUR_TURN');
 * ```
 */
export function reject<const C extends string>(code: GameErrorCode<C>, details?: Json): never {
  if (!GAME_CODE.test(code)) {
    throw new TypeError(`reject(): code "${code}" must match ${GAME_CODE.source}`);
  }
  if (isBuiltinErrorCode(code)) {
    throw new TypeError(
      `reject(): "${code}" is a built-in Shoehive code; choose a game-specific code`,
    );
  }
  throw new ShoehiveError({ code, source: 'game', details });
}

/** True for errors raised by `reject()` or by Shoehive. */
export function isShoehiveError(error: unknown): error is ShoehiveError {
  return error instanceof ShoehiveError;
}
