// State tab (raw and engine state) and Views tab (every viewer side by side).

import { h, type ComponentChild } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import type { DevTableDetail } from '../../protocol';
import { diffJson, EMPTY_DIFF } from '../json-diff';
import { Card } from './common';
import { JsonTree } from './json-tree';

/** Describes the baseline of change highlights, for example "since rev 12". */
export function baseLabel(base: DevTableDetail | null): string | null {
  if (base === null) return null;
  return `since rev ${String(base.rev)}${base.replayed ? ' (replay)' : ''}`;
}

export function StatePanel(props: {
  detail: DevTableDetail;
  base: DevTableDetail | null;
}): ComponentChild {
  const { detail, base } = props;
  const stateDiff = useMemo(
    () => (base === null ? EMPTY_DIFF : diffJson(base.state, detail.state)),
    [base, detail],
  );
  const engineDiff = useMemo(
    () => (base === null ? EMPTY_DIFF : diffJson(base.engine, detail.engine)),
    [base, detail],
  );
  const label = baseLabel(base);
  return h(
    'div',
    { class: 'columns two' },
    h(
      Card,
      { title: 'Raw state' },
      h('p', { class: 'note' }, 'Everything the game holds, every secret included.'),
      h(JsonTree, { value: detail.state, diff: stateDiff, label: 'Raw state', baseLabel: label }),
    ),
    h(
      Card,
      { title: 'Engine state' },
      h('p', { class: 'note' }, 'Engine bookkeeping, including the RNG seed.'),
      h(JsonTree, {
        value: detail.engine,
        diff: engineDiff,
        label: 'Engine state',
        baseLabel: label,
      }),
    ),
  );
}

/** What view highlights compare against. */
export type ViewCompare = 'revision' | 'spectator';

export function ViewsPanel(props: {
  detail: DevTableDetail;
  base: DevTableDetail | null;
}): ComponentChild {
  const { detail, base } = props;
  const [compare, setCompare] = useState<ViewCompare>('revision');
  const spectator = detail.views.find((view) => view.viewer === 'spectator');
  const diffs = useMemo(() => {
    if (compare === 'spectator') {
      return detail.views.map((view) =>
        spectator === undefined || view === spectator
          ? EMPTY_DIFF
          : diffJson(spectator.view, view.view),
      );
    }
    const before = new Map(base?.views.map((view) => [view.viewer, view.view]) ?? []);
    return detail.views.map((view) =>
      base === null ? EMPTY_DIFF : diffJson(before.get(view.viewer), view.view),
    );
  }, [base, detail, compare, spectator]);
  const revisionLabel = baseLabel(base);
  const option = (value: ViewCompare, text: string): ComponentChild =>
    h(
      'button',
      {
        type: 'button',
        'aria-pressed': compare === value,
        onClick: () => {
          setCompare(value);
        },
      },
      text,
    );
  return h(
    'div',
    null,
    h(
      'div',
      { class: 'views-head' },
      h(
        'p',
        { class: 'note' },
        'What each seat and the spectators receive, computed with view() on the same committed state.',
      ),
      h(
        'div',
        { class: 'segmented', role: 'group', 'aria-label': 'Highlight' },
        option('revision', 'Changes since last rev'),
        spectator === undefined ? null : option('spectator', 'Differences from spectator'),
      ),
    ),
    h(
      'div',
      { class: 'columns views' },
      detail.views.map((view, i) =>
        h(
          Card,
          {
            key: view.viewer,
            title: h(
              'span',
              null,
              view.label,
              ' ',
              h('span', { class: 'mono muted' }, view.viewer),
            ),
            class: view.viewer === 'spectator' ? 'spectator' : '',
          },
          h(JsonTree, {
            value: view.view,
            diff: diffs[i] ?? EMPTY_DIFF,
            label: `View for ${view.label}`,
            baseLabel:
              compare === 'spectator'
                ? view === spectator
                  ? null
                  : 'from the spectator view'
                : revisionLabel,
          }),
        ),
      ),
    ),
  );
}
