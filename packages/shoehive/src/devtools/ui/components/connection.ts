// Connection status: the header pill, the disconnected banner and the blocking screens
// for a missing or rejected token.

import { h, type ComponentChild } from 'preact';
import type { ConnStatus } from '../client';
import { formatDuration } from '../format';
import { Badge, useNow, type Tone } from './common';

/** How long a lockout lasts (ADR 0011 rule 6). */
export const LOCKOUT_MS = 60_000;

export function statusText(status: ConnStatus, now: number): { text: string; tone: Tone } {
  switch (status.kind) {
    case 'no-token':
      return { text: 'No token', tone: 'bad' };
    case 'connecting':
      return { text: status.attempt === 0 ? 'Connecting' : 'Reconnecting', tone: 'warn' };
    case 'open':
      return { text: 'Connected', tone: 'good' };
    case 'waiting':
      return {
        text: `Disconnected, retrying in ${formatDuration(Math.max(0, status.retryAt - now))}`,
        tone: 'warn',
      };
    case 'unauthorized':
      return { text: 'Token rejected', tone: 'bad' };
    case 'locked-out':
      return { text: 'Locked out', tone: 'bad' };
    case 'mismatch':
      return { text: 'Protocol mismatch', tone: 'bad' };
  }
}

export function StatusPill(props: { status: ConnStatus }): ComponentChild {
  const now = useNow(props.status.kind === 'waiting', 500);
  const { text, tone } = statusText(props.status, now);
  return h(
    'span',
    { class: 'status', role: 'status', 'aria-live': 'polite' },
    h(Badge, { tone }, text),
  );
}

const LOGGED_URL_HINT =
  'Open the inspector URL the server logged at startup. It looks like http://localhost:3000/__shoehive/#token=... and the token changes on every restart unless you set one in the devtools option.';

/** A blocking explanation when the inspector cannot connect at all. */
export function Blocker(props: { status: ConnStatus; onRetry: () => void }): ComponentChild {
  const now = useNow(props.status.kind === 'locked-out', 1000);
  switch (props.status.kind) {
    case 'no-token':
      return h(
        'div',
        { class: 'blocker', role: 'alert' },
        h('h1', null, 'No access token'),
        h(
          'p',
          null,
          'The inspector needs the token from its URL fragment (#token=...) to connect.',
        ),
        h('p', null, LOGGED_URL_HINT),
      );
    case 'unauthorized':
      return h(
        'div',
        { class: 'blocker', role: 'alert' },
        h('h1', null, 'The server rejected the token'),
        h(
          'p',
          null,
          'The token in this tab does not match the one the server is using, for example because the server restarted with a new token.',
        ),
        h('p', null, LOGGED_URL_HINT),
        h(
          'p',
          { class: 'muted' },
          'Five failed attempts in a minute lock this address out for a minute.',
        ),
      );
    case 'locked-out': {
      const left = Math.max(0, props.status.since + LOCKOUT_MS - now);
      return h(
        'div',
        { class: 'blocker', role: 'alert' },
        h('h1', null, 'Too many failed attempts'),
        h(
          'p',
          null,
          'This address made five failed attempts within a minute and is locked out for a minute.',
        ),
        h('p', null, LOGGED_URL_HINT),
        h(
          'button',
          {
            type: 'button',
            class: 'btn primary',
            disabled: left > 0,
            onClick: props.onRetry,
          },
          left > 0 ? `Try again in ${formatDuration(left)}` : 'Try again',
        ),
      );
    }
    case 'mismatch':
      return h(
        'div',
        { class: 'blocker', role: 'alert' },
        h('h1', null, 'Protocol mismatch'),
        h(
          'p',
          null,
          `The server speaks devtools protocol ${String(props.status.server)}, which this inspector does not understand. Reload the page so the server can send its own copy of the inspector.`,
        ),
      );
    case 'connecting':
    case 'waiting':
    case 'open':
      return null;
  }
}

/** Shown above stale data while the socket is down. */
export function DisconnectedBanner(props: {
  status: ConnStatus;
  onRetry: () => void;
}): ComponentChild {
  const now = useNow(props.status.kind === 'waiting', 500);
  if (props.status.kind !== 'waiting' && props.status.kind !== 'connecting') return null;
  return h(
    'div',
    { class: 'banner warn', role: 'status' },
    props.status.kind === 'waiting'
      ? `Connection lost. What you see may be out of date. Retrying in ${formatDuration(Math.max(0, props.status.retryAt - now))}. `
      : 'Connecting to the server… ',
    props.status.kind === 'waiting'
      ? h('button', { type: 'button', class: 'btn small', onClick: props.onRetry }, 'Retry now')
      : null,
  );
}
