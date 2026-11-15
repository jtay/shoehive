// The inspector's state and its reducer. Pure, so it is unit tested without a DOM.

import type { DevTableDetail, DevTableSummary, DevWelcome } from '../protocol';
import type { ConnStatus } from './client';

export type Page = { kind: 'home' } | { kind: 'sessions' } | { kind: 'table'; id: string };

export interface ReplayState {
  /** The seq the user asked for (the scrubber position). */
  seq: number;
  /** The replayed detail on screen, or `null` until the first one arrives. */
  shown: DevTableDetail | null;
  /** What was on screen before `shown`, the baseline for change highlights. */
  base: DevTableDetail | null;
  loading: boolean;
  error: string | null;
}

export interface AppState {
  conn: ConnStatus;
  welcome: DevWelcome | null;
  /** `null` until the first `tables.watch` result. */
  tables: DevTableSummary[] | null;
  page: Page;
  /** The latest live detail of the open table. */
  live: DevTableDetail | null;
  /** The previous live revision of the open table, the baseline for change highlights. */
  liveBase: DevTableDetail | null;
  /** Set when the open table could not be watched. */
  watchError: string | null;
  /** Set when the server closed the open table (`table.closed`). */
  closed: string | null;
  /** Time travel: set while showing a replayed copy instead of the live table. */
  replay: ReplayState | null;
}

export type AppAction =
  | { type: 'conn'; conn: ConnStatus }
  | { type: 'welcome'; welcome: DevWelcome }
  | { type: 'tables'; tables: DevTableSummary[] }
  | { type: 'navigate'; page: Page }
  | { type: 'detail'; detail: DevTableDetail }
  | { type: 'watch-error'; table: string; message: string }
  | { type: 'closed'; table: string; reason: string }
  | { type: 'seek'; seq: number }
  | { type: 'replayed'; seq: number; detail: DevTableDetail }
  | { type: 'replay-error'; seq: number; message: string }
  | { type: 'live' };

export function initialState(conn: ConnStatus): AppState {
  return {
    conn,
    welcome: null,
    tables: null,
    page: { kind: 'home' },
    live: null,
    liveBase: null,
    watchError: null,
    closed: null,
    replay: null,
  };
}

/** The id of the open table, or `null`. */
export function openTable(state: AppState): string | null {
  return state.page.kind === 'table' ? state.page.id : null;
}

/** What the table view shows now: the replayed copy while time travelling, else live. */
export function shownDetail(state: AppState): DevTableDetail | null {
  return state.replay === null ? state.live : (state.replay.shown ?? state.live);
}

/** The baseline for change highlights of what `shownDetail` returns. */
export function baseDetail(state: AppState): DevTableDetail | null {
  if (state.replay === null) return state.liveBase;
  return state.replay.shown === null ? state.liveBase : state.replay.base;
}

/** Clamps a seq to the open table's range `0..rev`. */
export function clampSeq(state: AppState, seq: number): number {
  const max = state.live?.rev ?? 0;
  return Math.min(max, Math.max(0, Math.round(seq)));
}

export function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'conn':
      return { ...state, conn: action.conn };
    case 'welcome':
      return { ...state, welcome: action.welcome };
    case 'tables':
      return { ...state, tables: action.tables };
    case 'navigate': {
      const same =
        action.page.kind === 'table' &&
        state.page.kind === 'table' &&
        action.page.id === state.page.id;
      if (same) return state;
      return {
        ...state,
        page: action.page,
        live: null,
        liveBase: null,
        watchError: null,
        closed: null,
        replay: null,
      };
    }
    case 'detail': {
      const detail = action.detail;
      if (detail.replayed || openTable(state) !== detail.id) return state;
      const live = state.live;
      let liveBase = state.liveBase;
      if (live === null || detail.rev < live.rev) liveBase = null;
      else if (detail.rev > live.rev) liveBase = live;
      return { ...state, live: detail, liveBase, watchError: null };
    }
    case 'watch-error':
      if (openTable(state) !== action.table) return state;
      return { ...state, watchError: action.message };
    case 'closed':
      if (openTable(state) !== action.table) return state;
      return { ...state, closed: action.reason };
    case 'seek': {
      const seq = clampSeq(state, action.seq);
      if (state.replay === null) {
        return {
          ...state,
          replay: { seq, shown: null, base: null, loading: true, error: null },
        };
      }
      if (state.replay.seq === seq && state.replay.shown?.seq === seq) return state;
      return { ...state, replay: { ...state.replay, seq, loading: true, error: null } };
    }
    case 'replayed': {
      const replay = state.replay;
      if (replay?.seq !== action.seq || action.detail.id !== openTable(state)) return state;
      return {
        ...state,
        replay: {
          seq: action.seq,
          shown: action.detail,
          base: replay.shown ?? state.live,
          loading: false,
          error: null,
        },
      };
    }
    case 'replay-error': {
      const replay = state.replay;
      if (replay?.seq !== action.seq) return state;
      return { ...state, replay: { ...replay, loading: false, error: action.message } };
    }
    case 'live':
      return state.replay === null ? state : { ...state, replay: null };
  }
}
