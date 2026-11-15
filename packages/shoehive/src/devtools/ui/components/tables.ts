// The sidebar: live table list (from `tables.watch`) and navigation.

import { h, type ComponentChild } from 'preact';
import { useState } from 'preact/hooks';
import type { DevGameInfo, DevTableSummary } from '../../protocol';
import { plural } from '../format';
import type { Page } from '../state';
import { Badge, type Tone } from './common';

export function statusTone(status: DevTableSummary['status']): Tone {
  switch (status) {
    case 'waiting':
      return 'info';
    case 'active':
      return 'good';
    case 'ended':
      return 'neutral';
  }
}

/** Case-insensitive filter on table id, game and status. */
export function filterTables(tables: readonly DevTableSummary[], query: string): DevTableSummary[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [...tables];
  return tables.filter(
    (table) =>
      table.id.toLowerCase().includes(q) ||
      table.game.toLowerCase().includes(q) ||
      table.status.includes(q) ||
      (q === 'dev' && table.dev) ||
      (q === 'faulted' && table.faulted),
  );
}

/** Newest first, then by id so the order is stable. */
export function sortTables(tables: readonly DevTableSummary[]): DevTableSummary[] {
  return [...tables].sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
}

function TableItem(props: {
  table: DevTableSummary;
  current: boolean;
  onOpen: (id: string) => void;
}): ComponentChild {
  const { table } = props;
  return h(
    'li',
    null,
    h(
      'button',
      {
        type: 'button',
        class: `table-item${props.current ? ' current' : ''}`,
        'aria-current': props.current ? 'page' : undefined,
        onClick: () => {
          props.onOpen(table.id);
        },
      },
      h(
        'span',
        { class: 'table-line' },
        h('span', { class: 'table-id mono' }, table.id),
        table.dev ? h(Badge, { tone: 'info', title: 'Fork made with devtools' }, 'dev') : null,
        table.faulted
          ? h(
              Badge,
              { tone: 'bad', title: 'A store write failed; the table rejects entries' },
              'faulted',
            )
          : null,
      ),
      h(
        'span',
        { class: 'table-line sub' },
        h('span', null, table.game),
        h(Badge, { tone: statusTone(table.status) }, table.status),
        h('span', { title: 'Revision' }, `rev ${String(table.rev)}`),
      ),
      h(
        'span',
        { class: 'table-line sub' },
        h('span', null, `seats ${String(table.seats.taken)}/${String(table.seats.total)}`),
        h('span', null, plural(table.connections, 'connection')),
      ),
    ),
  );
}

export function Sidebar(props: {
  tables: DevTableSummary[] | null;
  games: readonly DevGameInfo[];
  page: Page;
  onNavigate: (page: Page) => void;
}): ComponentChild {
  const [query, setQuery] = useState('');
  const current = props.page.kind === 'table' ? props.page.id : null;
  const all = props.tables ?? [];
  const shown = sortTables(filterTables(all, query));
  return h(
    'nav',
    { class: 'sidebar', 'aria-label': 'Tables and sessions' },
    h(
      'button',
      {
        type: 'button',
        class: `nav-item${props.page.kind === 'sessions' ? ' current' : ''}`,
        'aria-current': props.page.kind === 'sessions' ? 'page' : undefined,
        onClick: () => {
          props.onNavigate({ kind: 'sessions' });
        },
      },
      'Sessions and connections',
    ),
    h(
      'div',
      { class: 'sidebar-head' },
      h(
        'h2',
        { id: 'tables-heading' },
        'Tables',
        h('span', { class: 'count' }, String(all.length)),
      ),
    ),
    h('input', {
      type: 'search',
      class: 'filter',
      placeholder: 'Filter by id, game, status',
      'aria-label': 'Filter tables',
      value: query,
      onInput: (ev: Event) => {
        setQuery((ev.currentTarget as HTMLInputElement).value);
      },
    }),
    props.tables === null
      ? h('p', { class: 'empty' }, 'Loading tables…')
      : shown.length === 0
        ? h('p', { class: 'empty' }, all.length === 0 ? 'No tables yet.' : 'No tables match.')
        : h(
            'ul',
            { class: 'table-list', 'aria-labelledby': 'tables-heading' },
            shown.map((table) =>
              h(TableItem, {
                key: table.id,
                table,
                current: table.id === current,
                onOpen: (id) => {
                  props.onNavigate({ kind: 'table', id });
                },
              }),
            ),
          ),
    props.games.length === 0
      ? null
      : h(
          'div',
          { class: 'games' },
          h('h2', null, 'Games'),
          h(
            'ul',
            null,
            props.games.map((game) =>
              h(
                'li',
                { key: game.id },
                h('span', { class: 'mono' }, game.id),
                ` v${String(game.version)}, ${String(game.seats.min)} to ${String(game.seats.max)} seats`,
              ),
            ),
          ),
        ),
  );
}
