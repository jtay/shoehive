// A collapsible JSON tree with changed paths highlighted.

import { h, type ComponentChild } from 'preact';
import { useState } from 'preact/hooks';
import { plural, previewJson, truncate } from '../format';
import { childPath, kindOf, type Change, type JsonDiff } from '../json-diff';
import { copyText } from './common';

type Mode = 'default' | 'all' | 'changed' | 'collapsed';

/** Children rendered per container before a "show more" button. */
const PAGE = 100;
/** Depth limit for "expand all", so a deep value cannot freeze the page. */
const MAX_OPEN_DEPTH = 12;
/** By default, first-level containers open only when they are this small. */
const SMALL = 12;

function initiallyOpen(mode: Mode, depth: number, size: number, touched: boolean): boolean {
  if (depth === 0) return true;
  switch (mode) {
    case 'default':
      return depth === 1 && size <= SMALL;
    case 'all':
      return depth <= MAX_OPEN_DEPTH;
    case 'changed':
      return touched;
    case 'collapsed':
      return false;
  }
}

function containerSize(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (typeof value === 'object' && value !== null) return Object.keys(value).length;
  return 0;
}

function entriesOf(value: unknown): [string, unknown][] {
  if (Array.isArray(value)) return value.map((item: unknown, i) => [String(i), item]);
  if (typeof value === 'object' && value !== null) return Object.entries(value);
  return [];
}

function Scalar(props: { value: unknown }): ComponentChild {
  const kind = kindOf(props.value);
  const text =
    kind === 'string'
      ? JSON.stringify(truncate(props.value as string, 500))
      : kind === 'other'
        ? String(props.value)
        : JSON.stringify(props.value);
  return h('span', { class: `v v-${kind}` }, text);
}

function changeLabel(change: Change | undefined): string | null {
  switch (change) {
    case 'added':
      return 'added';
    case 'changed':
      return 'changed';
    case 'removed':
      return 'removed';
    case undefined:
      return null;
  }
}

interface NodeProps {
  name: string | null;
  value: unknown;
  path: string;
  depth: number;
  diff: JsonDiff;
  mode: Mode;
}

function Key(props: { name: string | null }): ComponentChild {
  if (props.name === null) return null;
  return h('span', { class: 'k' }, props.name, h('span', { class: 'punct' }, ': '));
}

function TreeNode(props: NodeProps): ComponentChild {
  const { name, value, path, depth, diff, mode } = props;
  const kind = kindOf(value);
  const change = diff.changes.get(path);
  const touched = diff.touched.has(path);
  const [open, setOpen] = useState(() => initiallyOpen(mode, depth, containerSize(value), touched));
  const [limit, setLimit] = useState(PAGE);
  const label = changeLabel(change);
  const rowClass = `row${change === undefined ? '' : ` ch-${change}`}`;
  const marker = label === null ? null : h('span', { class: 'sr-only' }, ` (${label})`);

  if (kind !== 'array' && kind !== 'object') {
    return h(
      'li',
      { class: rowClass },
      h('span', { class: 'twisty-pad' }),
      h(Key, { name }),
      h(Scalar, { value }),
      marker,
    );
  }

  const entries = entriesOf(value);
  const removed = diff.removed.get(path) ?? [];
  const brackets = kind === 'array' ? ['[', ']'] : ['{', '}'];
  if (entries.length === 0 && removed.length === 0) {
    return h(
      'li',
      { class: rowClass },
      h('span', { class: 'twisty-pad' }),
      h(Key, { name }),
      h('span', { class: 'punct' }, brackets.join('')),
      marker,
    );
  }
  const size =
    kind === 'array'
      ? `${String(entries.length)} ${entries.length === 1 ? 'item' : 'items'}`
      : `${String(entries.length)} ${entries.length === 1 ? 'key' : 'keys'}`;
  const childChanged = touched && change === undefined;

  return h(
    'li',
    { class: rowClass },
    h(
      'button',
      {
        type: 'button',
        class: 'twisty',
        'aria-expanded': open,
        onClick: () => {
          setOpen(!open);
        },
      },
      h('span', { class: 'chev', 'aria-hidden': 'true' }, open ? '▾' : '▸'),
      h(Key, { name }),
      open
        ? h('span', { class: 'punct' }, brackets[0])
        : h(
            'span',
            { class: 'preview' },
            h('span', { class: 'preview-json' }, previewJson(value, 60)),
            h('span', { class: 'size' }, size),
          ),
      childChanged
        ? h(
            'span',
            { class: 'dot', title: 'Contains changes' },
            h('span', { class: 'sr-only' }, ' (contains changes)'),
          )
        : null,
      marker,
    ),
    open
      ? h(
          'ul',
          { class: 'tree-children' },
          entries.slice(0, limit).map(([key, child]) =>
            h(TreeNode, {
              key,
              name: key,
              value: child,
              path: childPath(path, kind === 'array' ? Number(key) : key),
              depth: depth + 1,
              diff,
              mode,
            }),
          ),
          entries.length > limit
            ? h(
                'li',
                { class: 'row' },
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'link',
                    onClick: () => {
                      setLimit(limit + PAGE * 5);
                    },
                  },
                  `Show ${String(Math.min(PAGE * 5, entries.length - limit))} more of ${String(entries.length - limit)}`,
                ),
              )
            : null,
          removed.map((gone) =>
            h(
              'li',
              { key: `removed:${gone.key}`, class: 'row ch-removed' },
              h('span', { class: 'twisty-pad' }),
              h(Key, { name: gone.key }),
              h('span', { class: 'v v-removed' }, previewJson(gone.value, 60)),
              h('span', { class: 'sr-only' }, ' (removed)'),
            ),
          ),
        )
      : null,
    open ? h('span', { class: 'punct close' }, brackets[1]) : null,
  );
}

export interface JsonTreeProps {
  value: unknown;
  diff: JsonDiff;
  /** Accessible name of the tree, for example "Raw state". */
  label: string;
  /** Shown next to the change count, for example "since rev 12". */
  baseLabel?: string | null;
}

export function JsonTree(props: JsonTreeProps): ComponentChild {
  const [view, setView] = useState<{ mode: Mode; gen: number }>({ mode: 'default', gen: 0 });
  const [copied, setCopied] = useState<string | null>(null);
  const changed = props.diff.changes.size;
  const set = (mode: Mode): void => {
    setView({ mode, gen: view.gen + 1 });
  };
  const button = (
    text: string,
    onClick: () => void,
    extra?: Record<string, unknown>,
  ): ComponentChild => h('button', { type: 'button', class: 'mini', onClick, ...extra }, text);
  return h(
    'div',
    { class: 'tree' },
    h(
      'div',
      { class: 'tree-tools' },
      h(
        'span',
        { class: `change-count${changed > 0 ? ' has-changes' : ''}` },
        props.baseLabel == null
          ? ''
          : changed === 0
            ? `No changes ${props.baseLabel}`
            : `${plural(changed, 'change')} ${props.baseLabel}`,
      ),
      h(
        'span',
        { class: 'tree-buttons' },
        changed > 0
          ? button('Show changes', () => {
              set('changed');
            })
          : null,
        button('Expand all', () => {
          set('all');
        }),
        button('Collapse', () => {
          set('collapsed');
        }),
        button(copied ?? 'Copy JSON', () => {
          void copyText(JSON.stringify(props.value, null, 2)).then((ok) => {
            setCopied(ok ? 'Copied' : 'Copy failed');
            setTimeout(() => {
              setCopied(null);
            }, 1500);
          });
        }),
      ),
    ),
    h(
      'ul',
      { class: 'tree-root', role: 'group', 'aria-label': props.label },
      h(TreeNode, {
        key: view.gen,
        name: null,
        value: props.value,
        path: '',
        depth: 0,
        diff: props.diff,
        mode: view.mode,
      }),
    ),
  );
}
