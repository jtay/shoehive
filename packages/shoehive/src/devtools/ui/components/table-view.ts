// One table: header, time travel bar, fork and export, and the tabs.

import { Fragment, h, type ComponentChild } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import type { DevTableDetail, DevTableSummary, Fixture } from '../../protocol';
import { describeError, type Controller } from '../controller';
import { fixtureFileName } from '../format';
import { baseDetail, shownDetail, type AppState, type Page } from '../state';
import { Badge, copyText, Dialog, downloadText, Empty, ErrorNote, Tabs } from './common';
import { LogPanel } from './log';
import { DiagnosticsCard, MetaCard, SeatsCard } from './overview';
import { statusTone } from './tables';
import { StatePanel, ViewsPanel } from './views';

function TimeBar(props: {
  live: DevTableDetail;
  replay: AppState['replay'];
  ctl: Controller;
}): ComponentChild {
  const { live, replay, ctl } = props;
  const max = live.rev;
  const value = replay?.seq ?? max;
  return h(
    'div',
    {
      class: `timebar${replay === null ? '' : ' replaying'}`,
      role: 'group',
      'aria-label': 'Time travel',
    },
    h(
      'button',
      {
        type: 'button',
        class: 'btn icon',
        disabled: value <= 0,
        title: 'Step back one entry',
        'aria-label': 'Step back one entry',
        onClick: () => {
          ctl.seek(value - 1);
        },
      },
      h('span', { 'aria-hidden': 'true' }, '◀'),
    ),
    h('input', {
      type: 'range',
      class: 'scrubber',
      min: 0,
      max,
      step: 1,
      value,
      disabled: max === 0,
      'aria-label': 'Log position (seq)',
      'aria-valuetext': `seq ${String(value)} of ${String(max)}`,
      onInput: (ev: Event) => {
        ctl.seek(Number((ev.currentTarget as HTMLInputElement).value), true);
      },
    }),
    h(
      'button',
      {
        type: 'button',
        class: 'btn icon',
        disabled: value >= max,
        title: 'Step forward one entry',
        'aria-label': 'Step forward one entry',
        onClick: () => {
          ctl.seek(value + 1);
        },
      },
      h('span', { 'aria-hidden': 'true' }, '▶'),
    ),
    h('span', { class: 'seq-label mono' }, `seq ${String(value)} / ${String(max)}`),
    replay === null
      ? h(Badge, { tone: 'good', title: 'Showing the live table' }, 'live')
      : h(
          'button',
          {
            type: 'button',
            class: 'btn primary',
            onClick: () => {
              ctl.live();
            },
          },
          'Back to live',
        ),
  );
}

interface ExportReady {
  seq: number;
  fixture: Fixture;
  warning: string;
}

/** Fork and export: the buttons (in the toolbar) and their notices and dialog (below it). */
function useTableActions(props: {
  table: string;
  seq: number;
  production: boolean;
  connected: boolean;
  ctl: Controller;
  onNavigate: (page: Page) => void;
}): { buttons: ComponentChild; notices: ComponentChild } {
  const { table, seq, ctl } = props;
  const [busy, setBusy] = useState<'fork' | 'export' | null>(null);
  const [fork, setFork] = useState<{ id: string; seq: number } | null>(null);
  const [ready, setReady] = useState<ExportReady | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const closeDialog = useCallback(() => {
    setReady(null);
  }, []);
  useEffect(() => {
    setFork(null);
    setError(null);
    setReady(null);
  }, [table]);

  const doFork = async (): Promise<void> => {
    setBusy('fork');
    setError(null);
    try {
      const result = await ctl.fork(table, seq);
      setFork({ id: result.table, seq });
      setCopied(false);
    } catch (err) {
      setError(`Fork failed: ${describeError(err)}`);
    } finally {
      setBusy(null);
    }
  };
  const doExport = async (): Promise<void> => {
    setBusy('export');
    setError(null);
    try {
      const result = await ctl.exportFixture(table, seq);
      setReady({ seq, fixture: result.fixture, warning: result.warning });
    } catch (err) {
      setError(`Export failed: ${describeError(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const buttons = h(
    'div',
    { class: 'action-buttons' },
    props.production
      ? null
      : h(
          'button',
          {
            type: 'button',
            class: 'btn',
            disabled: busy !== null || !props.connected,
            title: 'Make a dev table from this point that normal clients can join',
            onClick: () => {
              void doFork();
            },
          },
          busy === 'fork' ? 'Forking…' : `Fork from seq ${String(seq)}`,
        ),
    h(
      'button',
      {
        type: 'button',
        class: 'btn',
        disabled: busy !== null || !props.connected,
        title: 'Download the log up to this point as a test fixture',
        onClick: () => {
          void doExport();
        },
      },
      busy === 'export' ? 'Preparing…' : `Export fixture to seq ${String(seq)}`,
    ),
  );
  const notices = h(
    Fragment,
    null,
    error === null ? null : h(ErrorNote, null, error),
    fork === null
      ? null
      : h(
          'div',
          { class: 'fork-result', role: 'status' },
          h(
            'p',
            null,
            `Forked seq ${String(fork.seq)} into `,
            h('code', null, fork.id),
            '. It is a dev table: not persisted, not listed in the lobby. Normal clients can join it by id and play on from that point.',
          ),
          h(
            'div',
            { class: 'action-buttons' },
            h(
              'button',
              {
                type: 'button',
                class: 'btn',
                onClick: () => {
                  props.onNavigate({ kind: 'table', id: fork.id });
                },
              },
              'Inspect the fork',
            ),
            h(
              'button',
              {
                type: 'button',
                class: 'btn',
                onClick: () => {
                  void copyText(fork.id).then(setCopied);
                },
              },
              copied ? 'Copied' : 'Copy id',
            ),
            h(
              'button',
              {
                type: 'button',
                class: 'btn quiet',
                onClick: () => {
                  setFork(null);
                },
              },
              'Dismiss',
            ),
          ),
        ),
    ready === null
      ? null
      : h(
          Dialog,
          {
            title: `Export fixture to seq ${String(ready.seq)}`,
            onClose: closeDialog,
            actions: [
              h(
                'button',
                {
                  key: 'cancel',
                  type: 'button',
                  class: 'btn quiet',
                  onClick: closeDialog,
                },
                'Cancel',
              ),
              h(
                'button',
                {
                  key: 'download',
                  type: 'button',
                  class: 'btn primary',
                  onClick: () => {
                    downloadText(
                      fixtureFileName(table, ready.seq),
                      `${JSON.stringify(ready.fixture, null, 2)}\n`,
                    );
                    setReady(null);
                  },
                },
                'Download .json',
              ),
            ],
          },
          h('p', { class: 'warning' }, ready.warning),
          h(
            'p',
            { class: 'muted' },
            `${String(ready.fixture.entries.length)} entries of ${ready.fixture.game} v${String(ready.fixture.version)}. Player ids are replaced with p0, p1 and so on; the seed is kept so the fixture replays.`,
          ),
        ),
  );
  return { buttons, notices };
}

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'state', label: 'State' },
  { id: 'views', label: 'Views' },
  { id: 'log', label: 'Log' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export function TableView(props: {
  state: AppState;
  summary: DevTableSummary | null;
  ctl: Controller;
  onNavigate: (page: Page) => void;
}): ComponentChild {
  const { state, ctl } = props;
  const [tab, setTab] = useState<TabId>('overview');
  const id = state.page.kind === 'table' ? state.page.id : '';
  const live = state.live;
  const detail = shownDetail(state);
  const base = baseDetail(state);
  const replay = state.replay;
  const connected = state.conn.kind === 'open';
  const seq = replay?.seq ?? live?.rev ?? 0;
  const actions = useTableActions({
    table: id,
    seq,
    production: state.welcome?.production ?? true,
    connected,
    ctl,
    onNavigate: props.onNavigate,
  });

  const head = h(
    'header',
    { class: 'page-head' },
    h(
      'div',
      { class: 'title' },
      h('h1', { class: 'mono' }, id),
      detail === null ? null : h('span', { class: 'muted' }, detail.game),
      detail === null
        ? null
        : h(Badge, { tone: statusTone(detail.meta.status) }, detail.meta.status),
      props.summary?.dev === true ? h(Badge, { tone: 'info' }, 'dev') : null,
      props.summary?.faulted === true ? h(Badge, { tone: 'bad' }, 'faulted') : null,
      props.summary === null
        ? null
        : h('span', { class: 'muted' }, `${String(props.summary.connections)} connected`),
    ),
  );

  if (live === null || detail === null) {
    return h(
      'div',
      { class: 'page' },
      head,
      state.watchError === null
        ? h(Empty, null, connected ? 'Loading table…' : 'Waiting for the connection…')
        : h(ErrorNote, null, `Could not open this table: ${state.watchError}`),
    );
  }

  const panelId = `table-panel-${tab}`;
  let panel: ComponentChild;
  switch (tab) {
    case 'overview':
      panel = h(
        'div',
        { class: 'stack' },
        h(
          'div',
          { class: 'columns two' },
          h(MetaCard, { meta: detail.meta, detail, live: !detail.replayed }),
          h(SeatsCard, { seats: detail.seats }),
        ),
        h(DiagnosticsCard, { diagnostics: live.diagnostics, replaying: replay !== null }),
      );
      break;
    case 'state':
      panel = h(StatePanel, { detail, base });
      break;
    case 'views':
      panel = h(ViewsPanel, { detail, base });
      break;
    case 'log':
      panel = h(LogPanel, {
        key: id,
        ctl,
        table: id,
        liveRev: live.rev,
        cursor: replay === null ? null : replay.seq,
        onSeek: (to: number) => {
          ctl.seek(to);
        },
      });
      break;
  }

  return h(
    'div',
    { class: `page${replay === null ? '' : ' is-replay'}` },
    head,
    state.closed === null
      ? null
      : h('p', { class: 'banner warn', role: 'status' }, `This table was closed: ${state.closed}`),
    state.watchError === null
      ? null
      : h(
          'p',
          { class: 'banner warn', role: 'status' },
          `Live updates stopped: ${state.watchError}. What you see is the last known state.`,
        ),
    h('div', { class: 'toolbar' }, h(TimeBar, { live, replay, ctl }), actions.buttons),
    actions.notices,
    replay === null
      ? null
      : h(
          'div',
          { class: 'banner replay', role: 'status' },
          h('strong', null, 'Replay, not live. '),
          replay.shown === null
            ? `Replaying to seq ${String(replay.seq)}…`
            : `Showing a replayed copy at seq ${String(replay.shown.seq)}; the live table is at rev ${String(live.rev)}.`,
          replay.loading && replay.shown !== null ? ` Loading seq ${String(replay.seq)}…` : '',
          replay.error === null
            ? null
            : h('span', { class: 'error-inline' }, ` Replay failed: ${replay.error}`),
        ),
    h(Tabs, {
      tabs: TABS.map((t) =>
        t.id === 'views'
          ? { id: t.id, label: `Views (${String(detail.views.length)})` }
          : t.id === 'overview' && live.diagnostics.length > 0
            ? {
                id: t.id,
                label: h(
                  'span',
                  null,
                  'Overview ',
                  h('span', { class: 'pill bad' }, String(live.diagnostics.length)),
                ),
              }
            : t,
      ),
      selected: tab,
      onSelect: (next) => {
        setTab(next as TabId);
      },
      idPrefix: 'table',
      label: 'Table sections',
    }),
    h(
      'div',
      { id: panelId, role: 'tabpanel', 'aria-labelledby': `table-tab-${tab}`, class: 'tabpanel' },
      panel,
    ),
  );
}
