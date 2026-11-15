// Overview tab: table meta (phase, turn, round, timers, result), seats, diagnostics.

import { h, type ComponentChild, type ComponentChildren } from 'preact';
import type { Diagnostic, TableMeta } from '../../../core/runtime';
import type { SeatInfo } from '../../../core/define';
import type { DevTableDetail } from '../../protocol';
import { formatClock, formatCountdown, formatDateTime, previewJson } from '../format';
import { Badge, Card, Empty, useNow } from './common';
import { statusTone } from './tables';

function Deadline(props: { deadline: number | null; now: number; live: boolean }): ComponentChild {
  const { deadline } = props;
  if (deadline === null) return h('span', { class: 'muted' }, 'no deadline');
  return h(
    'span',
    { class: 'deadline' },
    props.live
      ? h(
          'span',
          { class: deadline < props.now ? 'overdue' : 'countdown' },
          formatCountdown(deadline, props.now),
        )
      : null,
    h('span', { class: 'muted', title: formatDateTime(deadline) }, ` at ${formatClock(deadline)}`),
  );
}

function Field(props: { label: string; children?: ComponentChildren }): ComponentChild {
  return h('div', { class: 'field' }, h('dt', null, props.label), h('dd', null, props.children));
}

function seatList(seats: readonly number[]): string {
  return seats.length === 0 ? 'none' : seats.join(', ');
}

export function MetaCard(props: {
  meta: TableMeta;
  detail: DevTableDetail;
  live: boolean;
}): ComponentChild {
  const { meta, detail } = props;
  const timers = Object.entries(meta.timers).sort((a, b) => a[1] - b[1]);
  const ticking =
    props.live &&
    (meta.turn?.deadline != null || meta.round?.deadline != null || timers.length > 0);
  const now = useNow(ticking);
  return h(
    Card,
    { title: 'Meta' },
    h(
      'dl',
      { class: 'fields' },
      h(Field, { label: 'Status' }, h(Badge, { tone: statusTone(meta.status) }, meta.status)),
      h(Field, { label: 'Phase' }, meta.phase ?? h('span', { class: 'muted' }, 'none')),
      h(Field, { label: 'Revision' }, `rev ${String(detail.rev)}, seq ${String(detail.seq)}`),
      h(
        Field,
        { label: 'Turn' },
        meta.turn === null
          ? h('span', { class: 'muted' }, 'no turns in this phase')
          : h(
              'span',
              null,
              meta.turn.seat === null ? 'no eligible seat' : `seat ${String(meta.turn.seat)}`,
              ', ',
              h(Deadline, { deadline: meta.turn.deadline, now, live: props.live }),
            ),
      ),
      h(
        Field,
        { label: 'Round' },
        meta.round === null
          ? h('span', { class: 'muted' }, 'no rounds in this phase')
          : h(
              'span',
              null,
              `round ${String(meta.round.number)}, submitted ${String(meta.round.submitted.length)} of ${String(meta.round.participants.length)} (seats ${seatList(meta.round.submitted)} of ${seatList(meta.round.participants)}), `,
              h(Deadline, { deadline: meta.round.deadline, now, live: props.live }),
            ),
      ),
      h(
        Field,
        { label: 'Timers' },
        timers.length === 0
          ? h('span', { class: 'muted' }, 'no visible timers')
          : h(
              'ul',
              { class: 'plain' },
              timers.map(([name, deadline]) =>
                h(
                  'li',
                  { key: name },
                  h('span', { class: 'mono' }, name),
                  ' ',
                  h(Deadline, { deadline, now, live: props.live }),
                ),
              ),
            ),
      ),
      h(
        Field,
        { label: 'Result' },
        meta.result === null
          ? h('span', { class: 'muted' }, 'none yet')
          : h('code', { class: 'inline-json' }, previewJson(meta.result, 400)),
      ),
      h(
        Field,
        { label: 'Options' },
        h('code', { class: 'inline-json' }, previewJson(meta.options, 400)),
      ),
    ),
  );
}

export function SeatsCard(props: { seats: readonly SeatInfo[] }): ComponentChild {
  return h(
    Card,
    { title: `Seats (${String(props.seats.length)})` },
    props.seats.length === 0
      ? h(Empty, null, 'This table has no seats.')
      : h(
          'table',
          { class: 'grid' },
          h(
            'thead',
            null,
            h(
              'tr',
              null,
              h('th', null, 'Seat'),
              h('th', null, 'Status'),
              h('th', null, 'Player'),
              h('th', null, 'Connected'),
            ),
          ),
          h(
            'tbody',
            null,
            props.seats.map((seat, i) =>
              h(
                'tr',
                { key: i },
                h('td', { class: 'num' }, String(i)),
                h('td', null, seat.status),
                h(
                  'td',
                  null,
                  seat.player === null
                    ? h('span', { class: 'muted' }, 'empty')
                    : h(
                        'span',
                        null,
                        seat.player.name,
                        ' ',
                        h('span', { class: 'mono muted' }, seat.player.id),
                      ),
                ),
                h(
                  'td',
                  null,
                  seat.player === null
                    ? null
                    : h(
                        'span',
                        { class: `conn ${seat.connected ? 'on' : 'off'}` },
                        seat.connected ? 'connected' : 'disconnected',
                      ),
                ),
              ),
            ),
          ),
        ),
  );
}

export function DiagnosticsCard(props: {
  diagnostics: readonly Diagnostic[];
  replaying: boolean;
}): ComponentChild {
  const rows = [...props.diagnostics].sort((a, b) => b.at - a.at);
  return h(
    Card,
    { title: `Diagnostics (${String(rows.length)})`, class: 'diagnostics' },
    props.replaying
      ? h('p', { class: 'note' }, 'Diagnostics come from the live table; a replayed copy has none.')
      : null,
    rows.length === 0
      ? h(Empty, null, 'No rejected actions recorded.')
      : h(
          'table',
          { class: 'grid' },
          h(
            'thead',
            null,
            h(
              'tr',
              null,
              h('th', null, 'Time'),
              h('th', null, 'Action'),
              h('th', null, 'Seat'),
              h('th', null, 'Player'),
              h('th', null, 'Code'),
              h('th', null, 'Message'),
            ),
          ),
          h(
            'tbody',
            null,
            rows.map((d, i) =>
              h(
                'tr',
                { key: `${String(d.at)}:${String(i)}` },
                h('td', { class: 'mono', title: formatDateTime(d.at) }, formatClock(d.at)),
                h('td', { class: 'mono' }, d.name),
                h('td', { class: 'num' }, d.seat === null ? '' : String(d.seat)),
                h('td', { class: 'mono' }, d.player ?? ''),
                h('td', null, h(Badge, { tone: 'bad' }, d.code)),
                h('td', null, d.message),
              ),
            ),
          ),
        ),
  );
}
