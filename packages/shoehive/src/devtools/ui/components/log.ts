// Log tab: the action log (`table.log`) with seq, kind, name, seat, timing and
// expandable entries. Fetches the tail incrementally as the table's rev grows.

import { h, Fragment, type ComponentChild } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { LogEntry } from '../../../core/runtime';
import type { Controller } from '../controller';
import { describeError } from '../controller';
import {
  entryName,
  entrySeat,
  entrySummary,
  formatClock,
  formatDateTime,
  formatDelta,
} from '../format';
import { EMPTY_DIFF } from '../json-diff';
import { Badge, ErrorNote, type Tone } from './common';
import { JsonTree } from './json-tree';

/** Entries fetched at first, and per "load earlier" click. */
export const LOG_PAGE = 200;

/** Merges fetched entries into a sorted, de-duplicated list. */
export function mergeEntries(
  current: readonly LogEntry[],
  incoming: readonly LogEntry[],
): LogEntry[] {
  const bySeq = new Map<number, LogEntry>();
  for (const entry of current) bySeq.set(entry.seq, entry);
  for (const entry of incoming) bySeq.set(entry.seq, entry);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

function kindTone(kind: LogEntry['kind']): Tone {
  switch (kind) {
    case 'create':
      return 'info';
    case 'action':
      return 'good';
    case 'timer':
      return 'warn';
    case 'system':
      return 'neutral';
  }
}

type KindFilter = 'all' | LogEntry['kind'];

export function LogPanel(props: {
  ctl: Controller;
  table: string;
  liveRev: number;
  /** The seq being replayed, or `null` when live. */
  cursor: number | null;
  onSeek: (seq: number) => void;
}): ComponentChild {
  const { ctl, table, liveRev } = props;
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const [kind, setKind] = useState<KindFilter>('all');
  const sync = useRef({ busy: false, last: -1, first: -1, wanted: liveRev, alive: true });

  useEffect(() => {
    const s = sync.current;
    s.alive = true;
    return () => {
      s.alive = false;
    };
  }, []);

  useEffect(() => {
    const s = sync.current;
    // Read through a function: `alive` changes while awaiting.
    const alive = (): boolean => s.alive;
    s.wanted = liveRev;
    if (s.busy) return;
    const run = async (): Promise<void> => {
      s.busy = true;
      setLoading(true);
      try {
        while (alive() && s.last < s.wanted) {
          const from = s.last < 0 ? Math.max(0, s.wanted - LOG_PAGE + 1) : s.last + 1;
          const result = await ctl.log(table, from);
          if (!alive()) return;
          if (s.first < 0) s.first = result.entries[0]?.seq ?? from;
          const fetched = result.entries;
          s.last = Math.max(s.last, result.last, ...fetched.map((entry) => entry.seq));
          setEntries((current) => mergeEntries(current, fetched));
          if (fetched.length === 0 && result.last < s.wanted) break;
        }
        setError(null);
      } catch (err) {
        if (s.alive) setError(describeError(err));
      } finally {
        s.busy = false;
        if (s.alive) setLoading(false);
      }
    };
    void run();
  }, [ctl, table, liveRev]);

  const loadEarlier = async (): Promise<void> => {
    const s = sync.current;
    if (s.first <= 0) return;
    const to = s.first - 1;
    const from = Math.max(0, s.first - LOG_PAGE);
    setLoading(true);
    try {
      const result = await ctl.log(table, from, to);
      if (!s.alive) return;
      s.first = from;
      setEntries((current) => mergeEntries(current, result.entries));
      setError(null);
    } catch (err) {
      if (s.alive) setError(describeError(err));
    } finally {
      if (s.alive) setLoading(false);
    }
  };

  const toggle = (seq: number): void => {
    const next = new Set(expanded);
    if (next.has(seq)) next.delete(seq);
    else next.add(seq);
    setExpanded(next);
  };

  const first = entries[0]?.seq ?? 0;
  const previousAt = new Map<number, number>();
  for (let i = 1; i < entries.length; i++) {
    const entry = entries[i]!;
    previousAt.set(entry.seq, entries[i - 1]!.at);
  }
  const shown = entries.filter((entry) => kind === 'all' || entry.kind === kind).reverse();

  return h(
    'div',
    { class: 'log' },
    h(
      'div',
      { class: 'log-tools' },
      h(
        'label',
        null,
        'Kind ',
        h(
          'select',
          {
            value: kind,
            onChange: (ev: Event) => {
              setKind((ev.currentTarget as HTMLSelectElement).value as KindFilter);
            },
          },
          ['all', 'action', 'timer', 'system', 'create'].map((k) =>
            h('option', { key: k, value: k }, k),
          ),
        ),
      ),
      h(
        'span',
        { class: 'muted' },
        entries.length === 0
          ? ''
          : `Showing seq ${String(first)} to ${String(entries[entries.length - 1]!.seq)}, newest first`,
      ),
      loading ? h('span', { class: 'muted', role: 'status' }, 'Loading…') : null,
      first > 0
        ? h(
            'button',
            {
              type: 'button',
              class: 'mini',
              disabled: loading,
              onClick: () => {
                void loadEarlier();
              },
            },
            'Load earlier entries',
          )
        : null,
    ),
    error === null ? null : h(ErrorNote, null, `Could not load the log: ${error}`),
    h(
      'table',
      { class: 'grid log-table' },
      h(
        'thead',
        null,
        h(
          'tr',
          null,
          h('th', { class: 'num' }, 'Seq'),
          h('th', null, 'Time'),
          h('th', null, 'Since prev'),
          h('th', null, 'Kind'),
          h('th', null, 'Name'),
          h('th', null, 'Seat'),
          h('th', null, 'Details'),
          h('th', null, h('span', { class: 'sr-only' }, 'Time travel')),
        ),
      ),
      h(
        'tbody',
        null,
        shown.map((entry) => {
          const open = expanded.has(entry.seq);
          const prevAt = previousAt.get(entry.seq);
          const seat = entrySeat(entry);
          const future = props.cursor !== null && entry.seq > props.cursor;
          const atCursor = props.cursor === entry.seq;
          return h(
            Fragment,
            { key: entry.seq },
            h(
              'tr',
              {
                class: `${future ? 'future' : ''}${atCursor ? ' cursor' : ''}`,
                'aria-current': atCursor ? 'step' : undefined,
              },
              h('td', { class: 'num mono' }, String(entry.seq)),
              h('td', { class: 'mono', title: formatDateTime(entry.at) }, formatClock(entry.at)),
              h(
                'td',
                { class: 'mono muted' },
                prevAt === undefined ? '' : formatDelta(entry.at - prevAt),
              ),
              h('td', null, h(Badge, { tone: kindTone(entry.kind) }, entry.kind)),
              h(
                'td',
                null,
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'link mono',
                    'aria-expanded': open,
                    title: open ? 'Hide entry' : 'Show the whole entry',
                    onClick: () => {
                      toggle(entry.seq);
                    },
                  },
                  h('span', { 'aria-hidden': 'true' }, open ? '▾ ' : '▸ '),
                  entryName(entry),
                ),
              ),
              h('td', { class: 'num' }, seat === null ? '' : String(seat)),
              h('td', { class: 'summary mono' }, entrySummary(entry, 90)),
              h(
                'td',
                null,
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'mini',
                    title: `Time travel to seq ${String(entry.seq)}`,
                    'aria-label': `Time travel to seq ${String(entry.seq)}`,
                    onClick: () => {
                      props.onSeek(entry.seq);
                    },
                  },
                  'Go',
                ),
              ),
            ),
            open
              ? h(
                  'tr',
                  { class: 'entry-detail' },
                  h(
                    'td',
                    { colSpan: 8 },
                    h(JsonTree, {
                      value: entry,
                      diff: EMPTY_DIFF,
                      label: `Log entry ${String(entry.seq)}`,
                    }),
                  ),
                )
              : null,
          );
        }),
      ),
    ),
    entries.length === 0 && !loading && error === null
      ? h('p', { class: 'empty' }, 'No entries.')
      : null,
  );
}
