// Display helpers for the inspector: times, durations, countdowns and log entries.
// Pure functions, unit tested in test/devtools/ui.test.ts.

import type { LogEntry } from '../../core/runtime';

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** Local wall-clock time with milliseconds, for example `14:03:07.042`. */
export function formatClock(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** Local date and time to the second, for example `2026-11-15 14:03:07`. */
export function formatDateTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** A duration in milliseconds, compact: `850 ms`, `1.2 s`, `3 m 05 s`, `2 h 07 m`. */
export function formatDuration(ms: number): string {
  const abs = Math.abs(ms);
  const sign = ms < 0 ? '-' : '';
  if (abs < 1000) return `${sign}${String(Math.round(abs))} ms`;
  if (abs < 60_000) return `${sign}${(abs / 1000).toFixed(1)} s`;
  const totalSeconds = Math.floor(abs / 1000);
  if (abs < 3_600_000) {
    return `${sign}${String(Math.floor(totalSeconds / 60))} m ${pad(totalSeconds % 60)} s`;
  }
  const totalMinutes = Math.floor(totalSeconds / 60);
  return `${sign}${String(Math.floor(totalMinutes / 60))} h ${pad(totalMinutes % 60)} m`;
}

/** Time since the previous log entry, for example `+120 ms`. */
export function formatDelta(ms: number): string {
  return `+${formatDuration(Math.max(0, ms))}`;
}

/** Time left until `deadline`: `4.2 s left`, or `due 1.0 s ago` once it has passed. */
export function formatCountdown(deadline: number, now: number): string {
  const left = deadline - now;
  return left >= 0 ? `${formatDuration(left)} left` : `due ${formatDuration(-left)} ago`;
}

/** Shortens `text` to `max` characters, ending with an ellipsis when cut. */
export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

/** Compact one-line JSON for previews. */
export function previewJson(value: unknown, max = 80): string {
  let text: string;
  try {
    // JSON.stringify returns undefined (despite its type) for these.
    text =
      value === undefined || typeof value === 'function' || typeof value === 'symbol'
        ? String(value)
        : JSON.stringify(value);
  } catch {
    text = String(value);
  }
  return truncate(text, max);
}

/** The name shown for a log entry: action or timer name, system event, or `create`. */
export function entryName(entry: LogEntry): string {
  switch (entry.kind) {
    case 'create':
      return 'create';
    case 'action':
      return entry.name;
    case 'timer':
      return entry.name === entry.action ? entry.name : `${entry.name} (${entry.action})`;
    case 'system':
      return entry.event;
  }
}

/** The seat a log entry is about, or `null`. */
export function entrySeat(entry: LogEntry): number | null {
  return entry.kind === 'action' || entry.kind === 'system' ? entry.seat : null;
}

/** A short summary of what the entry carried (input, player, game). */
export function entrySummary(entry: LogEntry, max = 80): string {
  switch (entry.kind) {
    case 'create':
      return truncate(
        `${entry.game} v${entry.version}, options ${previewJson(entry.options)}`,
        max,
      );
    case 'action':
      return `${entry.player}: ${previewJson(entry.input, max)}`;
    case 'timer':
      return previewJson(entry.input, max);
    case 'system': {
      const player = entry.player;
      if (player === null) return '';
      return typeof player === 'string' ? player : `${player.name} (${player.id})`;
    }
  }
}

/** Seat label, `seat 0`, or a dash-free placeholder when there is no seat. */
export function seatLabel(seat: number | null): string {
  return seat === null ? '' : `seat ${String(seat)}`;
}

/** Number of `items` with a singular or plural noun: `1 table`, `3 tables`. */
export function plural(count: number, noun: string, pluralNoun = `${noun}s`): string {
  return `${String(count)} ${count === 1 ? noun : pluralNoun}`;
}

/** A file name for an exported fixture. */
export function fixtureFileName(table: string, seq: number): string {
  const safe = table.replace(/[^A-Za-z0-9_.-]+/g, '_');
  return `${safe}-seq${String(seq)}.fixture.json`;
}
