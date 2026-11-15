// Small shared components and hooks.

import { h, type ComponentChild, type ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

/** The current time, refreshed every `interval` ms while `active`. */
export function useNow(active: boolean, interval = 250): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const handle = setInterval(() => {
      setNow(Date.now());
    }, interval);
    return () => {
      clearInterval(handle);
    };
  }, [active, interval]);
  return now;
}

export type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info' | 'replay';

export function Badge(props: {
  tone?: Tone;
  title?: string;
  children?: ComponentChildren;
}): ComponentChild {
  return h(
    'span',
    { class: `badge tone-${props.tone ?? 'neutral'}`, title: props.title },
    props.children,
  );
}

export function Empty(props: { children?: ComponentChildren }): ComponentChild {
  return h('p', { class: 'empty' }, props.children);
}

export function ErrorNote(props: { children?: ComponentChildren }): ComponentChild {
  return h('p', { class: 'error-note', role: 'alert' }, props.children);
}

/** A labelled card section. */
export function Card(props: {
  title: ComponentChildren;
  actions?: ComponentChildren;
  class?: string;
  children?: ComponentChildren;
}): ComponentChild {
  return h(
    'section',
    { class: `card ${props.class ?? ''}` },
    h('header', { class: 'card-head' }, h('h3', null, props.title), props.actions ?? null),
    h('div', { class: 'card-body' }, props.children),
  );
}

export interface TabDef {
  id: string;
  label: ComponentChildren;
}

/** An accessible tab strip: arrow keys, Home and End move between tabs. */
export function Tabs(props: {
  tabs: readonly TabDef[];
  selected: string;
  onSelect: (id: string) => void;
  idPrefix: string;
  label: string;
}): ComponentChild {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(
    0,
    props.tabs.findIndex((tab) => tab.id === props.selected),
  );
  const move = (to: number): void => {
    const count = props.tabs.length;
    const next = ((to % count) + count) % count;
    const tab = props.tabs[next];
    if (tab === undefined) return;
    props.onSelect(tab.id);
    refs.current[next]?.focus();
  };
  const onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.key === 'ArrowRight') move(index + 1);
    else if (ev.key === 'ArrowLeft') move(index - 1);
    else if (ev.key === 'Home') move(0);
    else if (ev.key === 'End') move(props.tabs.length - 1);
    else return;
    ev.preventDefault();
  };
  return h(
    'div',
    { class: 'tabs', role: 'tablist', 'aria-label': props.label, onKeyDown },
    props.tabs.map((tab, i) =>
      h(
        'button',
        {
          key: tab.id,
          type: 'button',
          role: 'tab',
          id: `${props.idPrefix}-tab-${tab.id}`,
          'aria-selected': tab.id === props.selected,
          'aria-controls': `${props.idPrefix}-panel-${tab.id}`,
          tabIndex: tab.id === props.selected ? 0 : -1,
          class: 'tab',
          ref: (el: HTMLButtonElement | null) => {
            refs.current[i] = el;
          },
          onClick: () => {
            props.onSelect(tab.id);
          },
        },
        tab.label,
      ),
    ),
  );
}

/** A modal dialog built on `<dialog>`: focus is trapped and Escape closes it. */
export function Dialog(props: {
  title: string;
  onClose: () => void;
  children?: ComponentChildren;
  actions: ComponentChildren;
}): ComponentChild {
  const ref = useRef<HTMLDialogElement>(null);
  const { onClose } = props;
  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return undefined;
    if (!dialog.open) dialog.showModal();
    const cancel = (ev: Event): void => {
      ev.preventDefault();
      onClose();
    };
    dialog.addEventListener('cancel', cancel);
    return () => {
      dialog.removeEventListener('cancel', cancel);
      if (dialog.open) dialog.close();
    };
  }, [onClose]);
  return h(
    'dialog',
    { ref, class: 'dialog', 'aria-labelledby': 'dialog-title' },
    h('h2', { id: 'dialog-title' }, props.title),
    h('div', { class: 'dialog-body' }, props.children),
    h('div', { class: 'dialog-actions' }, props.actions),
  );
}

/** Copies `text` to the clipboard; resolves `false` when the browser refuses. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Downloads `text` as a file through a Blob and an object URL (no server round trip). */
export function downloadText(fileName: string, text: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
