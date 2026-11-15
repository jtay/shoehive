// Glue between the socket client and the reducer: subscriptions, time travel requests
// (debounced while dragging), fork, export, sessions and log fetches.

import type { DevResults } from '../protocol';
import { DevClient, DevRequestError, type DevPush } from './client';
import { clampSeq, openTable, type AppAction, type AppState, type Page } from './state';

/** Delay before a time-travel request while the scrubber is being dragged. */
export const SEEK_DEBOUNCE_MS = 150;

export function describeError(error: unknown): string {
  if (error instanceof DevRequestError) return `${error.message} (${error.code})`;
  return error instanceof Error ? error.message : String(error);
}

export interface ControllerOptions {
  url: string;
  token: string | null;
  dispatch: (action: AppAction) => void;
  getState: () => AppState;
  /** Called when the open page changes, to mirror it in the address bar. */
  onPage?: (page: Page) => void;
}

export class Controller {
  private readonly client: DevClient | null;
  private seekTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: ControllerOptions) {
    const { dispatch } = options;
    this.client =
      options.token === null
        ? null
        : new DevClient({
            url: options.url,
            token: options.token,
            onStatus: (conn) => {
              dispatch({ type: 'conn', conn });
            },
            onWelcome: (welcome) => {
              dispatch({ type: 'welcome', welcome });
              this.subscribe();
            },
            onPush: (push) => {
              this.push(push);
            },
          });
  }

  start(): void {
    this.client?.connect();
  }

  stop(): void {
    this.cancelSeek();
    this.client?.stop();
  }

  /** Reconnects now (after a lockout, or to skip the backoff wait). */
  retry(): void {
    this.client?.connect();
  }

  private get state(): AppState {
    return this.options.getState();
  }

  /** Watches the table list and the open table; runs after every (re)authentication. */
  private subscribe(): void {
    const client = this.client;
    if (client === null) return;
    client
      .request({ t: 'tables.watch' })
      .then((result) => {
        this.options.dispatch({ type: 'tables', tables: result.tables });
      })
      .catch(() => {
        // A disconnect; the next welcome subscribes again.
      });
    const table = openTable(this.state);
    if (table !== null) {
      this.watch(table);
      const replay = this.state.replay;
      if (replay !== null) this.fetchAt(table, replay.seq);
    }
  }

  private push(push: DevPush): void {
    const { dispatch } = this.options;
    switch (push.t) {
      case 'tables':
        dispatch({ type: 'tables', tables: push.tables });
        return;
      case 'table.update':
        dispatch({ type: 'detail', detail: push.detail });
        return;
      case 'table.closed':
        dispatch({ type: 'closed', table: push.table, reason: push.reason });
        return;
    }
  }

  private watch(table: string): void {
    const client = this.client;
    if (!client?.connected) return;
    client
      .request({ t: 'table.watch', table })
      .then((detail) => {
        this.options.dispatch({ type: 'detail', detail });
      })
      .catch((error: unknown) => {
        if (error instanceof DevRequestError && error.code === 'DISCONNECTED') return;
        this.options.dispatch({ type: 'watch-error', table, message: describeError(error) });
      });
  }

  /** Opens a page; switching tables moves the `table.watch` subscription. */
  navigate(page: Page): void {
    const previous = openTable(this.state);
    const next = page.kind === 'table' ? page.id : null;
    if (previous === next && page.kind === this.state.page.kind) return;
    this.cancelSeek();
    if (previous !== null && previous !== next && this.client?.connected === true) {
      this.client.request({ t: 'table.unwatch', table: previous }).catch(() => undefined);
    }
    this.options.dispatch({ type: 'navigate', page });
    this.options.onPage?.(page);
    if (next !== null && next !== previous) this.watch(next);
  }

  /** Time travel to `seq`. With `debounce`, waits until the scrubber settles. */
  seek(seq: number, debounce = false): void {
    const table = openTable(this.state);
    if (table === null) return;
    const target = clampSeq(this.state, seq);
    this.options.dispatch({ type: 'seek', seq: target });
    this.cancelSeek();
    if (debounce) {
      this.seekTimer = setTimeout(() => {
        this.seekTimer = null;
        this.fetchAt(table, target);
      }, SEEK_DEBOUNCE_MS);
    } else {
      this.fetchAt(table, target);
    }
  }

  /** Leaves time travel and shows the live table again. */
  live(): void {
    this.cancelSeek();
    this.options.dispatch({ type: 'live' });
  }

  private cancelSeek(): void {
    if (this.seekTimer !== null) clearTimeout(this.seekTimer);
    this.seekTimer = null;
  }

  private fetchAt(table: string, seq: number): void {
    const client = this.client;
    if (client === null) return;
    client
      .request({ t: 'table.at', table, seq })
      .then((detail) => {
        this.options.dispatch({ type: 'replayed', seq, detail });
      })
      .catch((error: unknown) => {
        this.options.dispatch({ type: 'replay-error', seq, message: describeError(error) });
      });
  }

  fork(table: string, seq: number): Promise<DevResults['table.fork']> {
    return this.require().request({ t: 'table.fork', table, seq });
  }

  exportFixture(table: string, seq: number): Promise<DevResults['table.export']> {
    return this.require().request({ t: 'table.export', table, seq });
  }

  sessions(): Promise<DevResults['sessions.list']> {
    return this.require().request({ t: 'sessions.list' });
  }

  log(table: string, from: number, to?: number): Promise<DevResults['table.log']> {
    return this.require().request(
      to === undefined ? { t: 'table.log', table, from } : { t: 'table.log', table, from, to },
    );
  }

  private require(): DevClient {
    if (this.client === null) throw new DevRequestError('NO_TOKEN', 'No access token.');
    return this.client;
  }
}
