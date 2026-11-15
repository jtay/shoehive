// The inspector's root component.

import { h, type ComponentChild } from 'preact';
import { useEffect, useMemo, useReducer, useRef } from 'preact/hooks';
import { Blocker, DisconnectedBanner, StatusPill } from './components/connection';
import { Empty } from './components/common';
import { SessionsPage } from './components/sessions';
import { Sidebar } from './components/tables';
import { TableView } from './components/table-view';
import { Controller } from './controller';
import { initialState, reducer, type AppState, type Page } from './state';

export interface AppProps {
  url: string;
  token: string | null;
  initialPage: Page;
  /** Mirrors the open page in the address bar. */
  onPage: (page: Page) => void;
}

function Home(props: { state: AppState }): ComponentChild {
  const count = props.state.tables?.length ?? 0;
  return h(
    'div',
    { class: 'page home' },
    h('h1', null, 'Shoehive devtools'),
    h(
      'p',
      null,
      count === 0
        ? 'No tables are open yet. Create one from a client and it shows up on the left.'
        : 'Pick a table on the left to see its state, every viewer’s view and its action log.',
    ),
    h(
      'ul',
      { class: 'plain hints' },
      h('li', null, 'Everything here is read-only against live tables.'),
      h(
        'li',
        null,
        'Time travel replays a copy of the table; the live game is never paused or touched.',
      ),
      h(
        'li',
        null,
        'Fork turns a point in time into a dev table you can join from the normal client.',
      ),
      h(
        'li',
        null,
        'Export downloads a fixture that shoehive/testing can replay as a regression test.',
      ),
    ),
  );
}

export function App(props: AppProps): ComponentChild {
  const [state, dispatch] = useReducer(
    reducer,
    props.token === null ? { kind: 'no-token' } : { kind: 'connecting', attempt: 0 },
    initialState,
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const { onPage, url, token, initialPage } = props;

  const ctl = useMemo(
    () =>
      new Controller({
        url,
        token,
        dispatch,
        getState: () => stateRef.current,
        onPage,
      }),
    [url, token, onPage],
  );

  useEffect(() => {
    if (initialPage.kind !== 'home') ctl.navigate(initialPage);
    ctl.start();
    return () => {
      ctl.stop();
    };
  }, [ctl, initialPage]);

  useEffect(() => {
    const id = state.page.kind === 'table' ? state.page.id : null;
    const suffix = state.replay === null ? '' : ` @ seq ${String(state.replay.seq)}`;
    document.title = id === null ? 'Shoehive devtools' : `${id}${suffix} | Shoehive devtools`;
  }, [state.page, state.replay]);

  const blocker = h(Blocker, {
    status: state.conn,
    onRetry: () => {
      ctl.retry();
    },
  });
  const navigate = (page: Page): void => {
    ctl.navigate(page);
  };
  const production = state.welcome?.production === true;

  let main: ComponentChild;
  if (state.page.kind === 'table') {
    const id = state.page.id;
    main = h(TableView, {
      state,
      summary: state.tables?.find((table) => table.id === id) ?? null,
      ctl,
      onNavigate: navigate,
    });
  } else if (state.page.kind === 'sessions') {
    main = h(SessionsPage, { ctl, connected: state.conn.kind === 'open', onNavigate: navigate });
  } else {
    main = state.welcome === null ? h(Empty, null, 'Connecting…') : h(Home, { state });
  }

  const blocked =
    state.conn.kind === 'no-token' ||
    state.conn.kind === 'unauthorized' ||
    state.conn.kind === 'locked-out' ||
    state.conn.kind === 'mismatch';

  return h(
    'div',
    { class: 'app' },
    h(
      'header',
      { class: 'topbar' },
      h(
        'button',
        {
          type: 'button',
          class: 'brand',
          onClick: () => {
            navigate({ kind: 'home' });
          },
        },
        'Shoehive ',
        h('span', null, 'devtools'),
      ),
      production
        ? h(
            'span',
            { class: 'badge tone-bad', title: 'NODE_ENV=production: forks are refused' },
            'production',
          )
        : null,
      h('span', { class: 'spacer' }),
      h(StatusPill, { status: state.conn }),
    ),
    blocked
      ? h('main', { class: 'main solo' }, blocker)
      : h(
          'div',
          { class: 'layout' },
          h(Sidebar, {
            tables: state.tables,
            games: state.welcome?.games ?? [],
            page: state.page,
            onNavigate: navigate,
          }),
          h(
            'main',
            { class: 'main', id: 'main' },
            h(DisconnectedBanner, {
              status: state.conn,
              onRetry: () => {
                ctl.retry();
              },
            }),
            main,
          ),
        ),
  );
}
