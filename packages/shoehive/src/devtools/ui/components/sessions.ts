// Sessions page: players and connections from `sessions.list`, fetched on demand.

import { h, type ComponentChild } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import type { DevResults } from '../../protocol';
import { describeError, type Controller } from '../controller';
import { formatClock, formatDateTime, formatDuration } from '../format';
import type { Page } from '../state';
import { Badge, Card, Empty, ErrorNote, useNow } from './common';

function TableLinks(props: {
  tables: readonly string[];
  onNavigate: (page: Page) => void;
}): ComponentChild {
  if (props.tables.length === 0) return h('span', { class: 'muted' }, 'none');
  return h(
    'span',
    { class: 'links' },
    props.tables.map((id) =>
      h(
        'button',
        {
          key: id,
          type: 'button',
          class: 'link mono',
          onClick: () => {
            props.onNavigate({ kind: 'table', id });
          },
        },
        id,
      ),
    ),
  );
}

export function SessionsPage(props: {
  ctl: Controller;
  connected: boolean;
  onNavigate: (page: Page) => void;
}): ComponentChild {
  const { ctl, connected } = props;
  const [data, setData] = useState<DevResults['sessions.list'] | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const now = useNow(data !== null, 1000);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const result = await ctl.sessions();
      setData(result);
      setFetchedAt(Date.now());
      setError(null);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, [ctl]);

  useEffect(() => {
    if (connected) void refresh();
  }, [connected, refresh]);

  return h(
    'div',
    { class: 'page' },
    h(
      'header',
      { class: 'page-head' },
      h('h1', null, 'Sessions and connections'),
      h(
        'div',
        { class: 'page-actions' },
        fetchedAt === null
          ? null
          : h('span', { class: 'muted' }, `Fetched at ${formatClock(fetchedAt)}`),
        h(
          'button',
          {
            type: 'button',
            class: 'btn',
            disabled: loading || !connected,
            onClick: () => {
              void refresh();
            },
          },
          loading ? 'Refreshing…' : 'Refresh',
        ),
      ),
    ),
    error === null ? null : h(ErrorNote, null, `Could not list sessions: ${error}`),
    data === null
      ? h(Empty, null, loading ? 'Loading…' : 'Not loaded yet.')
      : h(
          'div',
          { class: 'stack' },
          h(
            Card,
            { title: `Sessions (${String(data.sessions.length)})` },
            data.sessions.length === 0
              ? h(Empty, null, 'No sessions.')
              : h(
                  'table',
                  { class: 'grid' },
                  h(
                    'thead',
                    null,
                    h(
                      'tr',
                      null,
                      h('th', null, 'Player'),
                      h('th', null, 'Name'),
                      h('th', null, 'Kind'),
                      h('th', { class: 'num' }, 'Connections'),
                      h('th', null, 'Tables'),
                    ),
                  ),
                  h(
                    'tbody',
                    null,
                    data.sessions.map((s) =>
                      h(
                        'tr',
                        { key: s.player },
                        h('td', { class: 'mono' }, s.player),
                        h('td', null, s.name),
                        h(
                          'td',
                          null,
                          s.guest ? h(Badge, null, 'guest') : h(Badge, { tone: 'info' }, 'account'),
                        ),
                        h(
                          'td',
                          { class: 'num' },
                          h(
                            'span',
                            { class: `conn ${s.connections > 0 ? 'on' : 'off'}` },
                            String(s.connections),
                          ),
                        ),
                        h(
                          'td',
                          null,
                          h(TableLinks, { tables: s.tables, onNavigate: props.onNavigate }),
                        ),
                      ),
                    ),
                  ),
                ),
          ),
          h(
            Card,
            { title: `Connections (${String(data.connections.length)})` },
            data.connections.length === 0
              ? h(Empty, null, 'No open connections.')
              : h(
                  'table',
                  { class: 'grid' },
                  h(
                    'thead',
                    null,
                    h(
                      'tr',
                      null,
                      h('th', null, 'Player'),
                      h('th', null, 'Remote address'),
                      h('th', null, 'Connected'),
                      h('th', null, 'Tables'),
                    ),
                  ),
                  h(
                    'tbody',
                    null,
                    data.connections.map((c, i) =>
                      h(
                        'tr',
                        { key: `${String(c.connectedAt)}:${String(i)}` },
                        h(
                          'td',
                          { class: 'mono' },
                          c.player ?? h('span', { class: 'muted' }, 'not identified'),
                        ),
                        h(
                          'td',
                          { class: 'mono' },
                          c.remote ?? h('span', { class: 'muted' }, 'unknown'),
                        ),
                        h(
                          'td',
                          { title: formatDateTime(c.connectedAt) },
                          `${formatDuration(Math.max(0, now - c.connectedAt))} ago`,
                        ),
                        h(
                          'td',
                          null,
                          h(TableLinks, { tables: c.tables, onNavigate: props.onNavigate }),
                        ),
                      ),
                    ),
                  ),
                ),
          ),
        ),
  );
}
