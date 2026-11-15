/**
 * shoehive/react: React hooks and a provider built on shoehive/client.
 *
 * ```tsx
 * <ShoehiveProvider url="ws://localhost:3000/shoehive">
 *   <Board tableId={id} />
 * </ShoehiveProvider>
 *
 * function Board({ tableId }: { tableId: string }) {
 *   const { view, mySeat, act, pending } = useTable<typeof ticTacToe>(tableId);
 *   ...
 * }
 * ```
 *
 * @packageDocumentation
 */
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  createClient,
  type ActArgs,
  type ActResult,
  type ClientOptions,
  type ConnectionStatus,
  type ShoehiveClient,
  type TableHandle,
} from '../client/client';
import type { AnyGame, GameActions, GameView, SeatInfo } from '../core/define';
import type { Json } from '../core/json';
import type { TableMeta } from '../core/runtime';
import type { LobbyDocument, TableDocument, Welcome } from '../protocol/messages';

const ClientContext = createContext<ShoehiveClient | null>(null);

export type ShoehiveProviderProps = { children?: ReactNode } & (
  | { client: ShoehiveClient; url?: never }
  | ({ client?: never } & ClientOptions)
);

/**
 * Provides a client to the hooks below. Pass a `client` you created, or client options
 * (`url`, `name`...) and the provider creates one and closes it on unmount.
 */
export function ShoehiveProvider(props: ShoehiveProviderProps): ReactNode {
  const { children } = props;
  const [owned] = useState(() => (props.client ? null : createClient(props as ClientOptions)));
  const client = props.client ?? owned!;
  useEffect(
    () => () => {
      owned?.close();
    },
    [owned],
  );
  return createElement(ClientContext.Provider, { value: client }, children);
}

/** The client from the nearest `ShoehiveProvider`. */
export function useClient<Games extends readonly AnyGame[] = readonly AnyGame[]>(): ShoehiveClient<Games> {
  const client = useContext(ClientContext);
  if (!client) throw new Error('useClient(): wrap your app in <ShoehiveProvider>');
  return client as unknown as ShoehiveClient<Games>;
}

/** Connection status and the current player. Re-renders on changes. */
export function useConnection(): { status: ConnectionStatus; player: Welcome['player'] | null } {
  const client = useClient();
  const status = useSyncExternalStore(
    (onChange) => client.onStatus(onChange),
    () => client.status,
    () => client.status,
  );
  return { status, player: client.player };
}

/** The lobby document, kept up to date while the component is mounted. */
export function useLobby(): LobbyDocument | null {
  const client = useClient();
  const [doc, setDoc] = useState<LobbyDocument | null>(null);
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    void client.lobby().then((lobby) => {
      if (cancelled) return;
      setDoc(lobby.doc);
      unsubscribe = lobby.subscribe(setDoc);
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [client]);
  return doc;
}

export interface UseTable<G extends AnyGame> {
  /** `joining` until the first snapshot, then `ready`; `error` if joining failed. */
  status: 'idle' | 'joining' | 'ready' | 'error' | 'closed';
  error: Error | null;
  table: TableHandle<G> | null;
  doc: TableDocument | null;
  view: GameView<G> | null;
  meta: TableMeta | null;
  seats: SeatInfo[];
  you: TableDocument['you'] | null;
  mySeat: number | null;
  /** Number of actions awaiting their ack. */
  pending: number;
  /** The last action error (cleared by the next successful action). */
  actionError: Error | null;
  act: <K extends keyof GameActions<G> & string>(name: K, ...input: ActArgs<G, K>) => Promise<ActResult>;
  sit: (seat?: number) => Promise<number>;
  stand: (seat?: number) => Promise<void>;
  leave: () => Promise<void>;
}

const noopSubscribe = (): (() => void) => () => undefined;

/**
 * Joins a table (once per client; later calls reuse it) and returns its live document
 * with bound actions. Unmounting does not leave the table: call `leave()` for that.
 */
export function useTable<G extends AnyGame = AnyGame>(
  tableId: string | null | undefined,
  options: { as?: 'player' | 'spectator' } = {},
): UseTable<G> {
  const client = useClient();
  const [table, setTable] = useState<TableHandle<G> | null>(null);
  const [status, setStatus] = useState<UseTable<G>['status']>(tableId ? 'joining' : 'idle');
  const [error, setError] = useState<Error | null>(null);
  const [pending, setPending] = useState(0);
  const [actionError, setActionError] = useState<Error | null>(null);
  const as = options.as ?? 'player';

  useEffect(() => {
    if (!tableId) {
      setTable(null);
      setStatus('idle');
      return;
    }
    let cancelled = false;
    setStatus('joining');
    setError(null);
    client.join<G>(tableId, { as }).then(
      (handle) => {
        if (cancelled) return;
        setTable(handle);
        setStatus('ready');
      },
      (err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setStatus('error');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, tableId, as]);

  const doc = useSyncExternalStore(
    table ? (onChange) => table.subscribe(onChange) : noopSubscribe,
    () => table?.doc ?? null,
    () => table?.doc ?? null,
  );

  const tableRef = useRef(table);
  tableRef.current = table;
  const requireTable = (): TableHandle<G> => {
    if (!tableRef.current) throw new Error('useTable(): the table is not joined yet');
    return tableRef.current;
  };

  const act = useCallback(
    async <K extends keyof GameActions<G> & string>(name: K, ...input: ActArgs<G, K>): Promise<ActResult> => {
      setPending((n) => n + 1);
      try {
        const result = await requireTable().act(name, ...input);
        setActionError(null);
        return result;
      } catch (err) {
        setActionError(err instanceof Error ? err : new Error(String(err)));
        throw err;
      } finally {
        setPending((n) => n - 1);
      }
    },
    [],
  );
  const sit = useCallback((seat?: number) => requireTable().sit(seat), []);
  const stand = useCallback((seat?: number) => requireTable().stand(seat), []);
  const leave = useCallback(() => requireTable().leave(), []);

  return {
    status: table?.closedReason ? 'closed' : status,
    error,
    table,
    doc,
    view: (doc?.view as GameView<G> | undefined) ?? null,
    meta: doc?.meta ?? null,
    seats: doc?.seats ?? [],
    you: doc?.you ?? null,
    mySeat: doc?.you.seats[0] ?? null,
    pending,
    actionError,
    act,
    sit,
    stand,
    leave,
  };
}

/** Calls `handler` for every `ctx.emit(name, ...)` event from the table. */
export function useTableEvent(
  table: TableHandle | null,
  name: string,
  handler: (event: { payload: Json; rev: number }) => void,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    if (!table) return;
    return table.on(name, (event) => {
      handlerRef.current(event);
    });
  }, [table, name]);
}

/** Server time (epoch ms), re-rendering every `intervalMs`: for countdowns to deadlines. */
export function useServerTime(intervalMs = 250): number {
  const client = useClient();
  const [now, setNow] = useState(() => client.serverNow());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(client.serverNow());
    }, intervalMs);
    return () => {
      clearInterval(timer);
    };
  }, [client, intervalMs]);
  return now;
}
