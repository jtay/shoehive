// Structural diff of two JSON values, used to highlight what changed between two
// revisions of a table (raw state, engine state, each viewer's view).
//
// Paths are JSON pointers (RFC 6901): "" is the root, "/players/0/name" a leaf.

export type Change = 'added' | 'removed' | 'changed';

export interface JsonDiff {
  /** Every path whose value was added, removed or changed. */
  readonly changes: ReadonlyMap<string, Change>;
  /** Paths that changed or have a changed descendant (for markers on collapsed nodes). */
  readonly touched: ReadonlySet<string>;
  /** Keys (or indexes) removed under each object or array path, with their old values. */
  readonly removed: ReadonlyMap<string, readonly { key: string; value: unknown }[]>;
}

export const EMPTY_DIFF: JsonDiff = {
  changes: new Map(),
  touched: new Set(),
  removed: new Map(),
};

/** Escapes one reference token for a JSON pointer (RFC 6901 section 3). */
export function escapeToken(key: string): string {
  return key.replace(/~/g, '~0').replace(/\//g, '~1');
}

/** Appends a key or index to a JSON pointer. */
export function childPath(parent: string, key: string | number): string {
  return `${parent}/${typeof key === 'number' ? String(key) : escapeToken(key)}`;
}

export type Kind = 'null' | 'boolean' | 'number' | 'string' | 'array' | 'object' | 'other';

export function kindOf(value: unknown): Kind {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  switch (typeof value) {
    case 'boolean':
      return 'boolean';
    case 'number':
      return 'number';
    case 'string':
      return 'string';
    case 'object':
      return 'object';
    default:
      return 'other';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return kindOf(value) === 'object';
}

/**
 * Compares `prev` and `next`. With no baseline (`prev` undefined) nothing is reported as
 * changed, so a freshly opened table is not highlighted all over.
 */
export function diffJson(prev: unknown, next: unknown): JsonDiff {
  if (prev === undefined) return EMPTY_DIFF;
  const changes = new Map<string, Change>();
  const touched = new Set<string>();
  const removed = new Map<string, { key: string; value: unknown }[]>();

  const walk = (a: unknown, b: unknown, path: string): boolean => {
    const ka = kindOf(a);
    const kb = kindOf(b);
    if (ka !== kb) {
      changes.set(path, 'changed');
      touched.add(path);
      return true;
    }
    let any = false;
    if (Array.isArray(a) && Array.isArray(b)) {
      const shared = Math.min(a.length, b.length);
      for (let i = 0; i < shared; i++) {
        if (walk(a[i], b[i], childPath(path, i))) any = true;
      }
      for (let i = shared; i < b.length; i++) {
        const p = childPath(path, i);
        changes.set(p, 'added');
        touched.add(p);
        any = true;
      }
      if (a.length > b.length) {
        const gone: { key: string; value: unknown }[] = [];
        for (let i = shared; i < a.length; i++) {
          changes.set(childPath(path, i), 'removed');
          gone.push({ key: String(i), value: a[i] });
        }
        removed.set(path, gone);
        any = true;
      }
    } else if (isRecord(a) && isRecord(b)) {
      for (const key of Object.keys(b)) {
        const p = childPath(path, key);
        if (!Object.hasOwn(a, key)) {
          changes.set(p, 'added');
          touched.add(p);
          any = true;
        } else if (walk(a[key], b[key], p)) {
          any = true;
        }
      }
      const gone: { key: string; value: unknown }[] = [];
      for (const key of Object.keys(a)) {
        if (!Object.hasOwn(b, key)) {
          changes.set(childPath(path, key), 'removed');
          gone.push({ key, value: a[key] });
        }
      }
      if (gone.length > 0) {
        removed.set(path, gone);
        any = true;
      }
    } else if (!Object.is(a, b)) {
      changes.set(path, 'changed');
      touched.add(path);
      return true;
    }
    if (any) touched.add(path);
    return any;
  };

  walk(prev, next, '');
  return { changes, touched, removed };
}
