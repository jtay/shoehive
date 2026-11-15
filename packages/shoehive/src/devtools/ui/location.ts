// Where the inspector connects and how it gets its token (ADR 0011 rule 6).
//
// The token arrives in the URL fragment (`#token=...`), which browsers never send to
// the server. After reading it we remove it from the address bar with
// `history.replaceState` and keep it in that history entry's state object, so a reload
// of the same tab still works. It never goes into a query string or localStorage.

import type { Page } from './state';

/** Key under which the token is kept in `history.state`. */
export const TOKEN_STATE_KEY = 'shoehiveDevtoolsToken';

/** Reads `token` from a fragment such as `#token=abc` or `#a=1&token=abc`. */
export function tokenFromHash(hash: string): string | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (raw === '') return null;
  const token = new URLSearchParams(raw).get('token');
  return token === null || token === '' ? null : token;
}

/** The fragment without its `token` parameter (empty string when nothing is left). */
export function hashWithoutToken(hash: string): string {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const params = new URLSearchParams(raw);
  params.delete('token');
  const rest = params.toString();
  return rest === '' ? '' : `#${rest}`;
}

function tokenFromState(state: unknown): string | null {
  if (typeof state !== 'object' || state === null) return null;
  const value = (state as Record<string, unknown>)[TOKEN_STATE_KEY];
  return typeof value === 'string' && value !== '' ? value : null;
}

interface LocationLike {
  readonly protocol: string;
  readonly host: string;
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
}

interface HistoryLike {
  readonly state: unknown;
  replaceState(data: unknown, unused: string, url?: string | null): void;
}

/**
 * Takes the token from the fragment (clearing it from the address bar) or, after a
 * reload, from the history entry. Returns `null` when there is none.
 */
export function takeToken(location: LocationLike, history: HistoryLike): string | null {
  const fromHash = tokenFromHash(location.hash);
  if (fromHash !== null) {
    const previous =
      typeof history.state === 'object' && history.state !== null
        ? (history.state as Record<string, unknown>)
        : {};
    history.replaceState(
      { ...previous, [TOKEN_STATE_KEY]: fromHash },
      '',
      `${location.pathname}${location.search}${hashWithoutToken(location.hash)}`,
    );
    return fromHash;
  }
  return tokenFromState(history.state);
}

/** The devtools base path for a page path: `/__shoehive/` and `/__shoehive/index.html` give `/__shoehive`. */
export function basePath(pathname: string): string {
  let path = pathname.replace(/\/index\.html$/, '');
  while (path.endsWith('/')) path = path.slice(0, -1);
  return path;
}

/** The devtools WebSocket URL on the same host: `<base path>/ws`. */
export function socketUrl(location: Pick<LocationLike, 'protocol' | 'host' | 'pathname'>): string {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${location.host}${basePath(location.pathname)}/ws`;
}

/** The page named in the fragment: `#table=<id>`, `#sessions`, or the home page. */
export function pageFromHash(hash: string): Page {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const table = params.get('table');
  if (table !== null && table !== '') return { kind: 'table', id: table };
  if (params.has('sessions')) return { kind: 'sessions' };
  return { kind: 'home' };
}

/** The fragment for a page (never contains the token). */
export function hashForPage(page: Page): string {
  switch (page.kind) {
    case 'home':
      return '';
    case 'sessions':
      return '#sessions';
    case 'table':
      return `#${new URLSearchParams({ table: page.id }).toString()}`;
  }
}
