// Structural JSON diff and patch (ADR 0003). Produces RFC 6902 operations using only
// add, remove and replace. Objects diff by key, arrays by index, and identical
// references short-circuit, which makes Mutative's structural sharing pay off.

import { escapePointer, unescapePointer, type Json } from './json';

export type JsonPatchOp =
  | { op: 'add'; path: string; value: Json }
  | { op: 'remove'; path: string }
  | { op: 'replace'; path: string; value: Json };

const isObject = (v: unknown): v is Record<string, Json> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Operations that turn `from` into `to`. */
export function diff(from: Json, to: Json): JsonPatchOp[] {
  const ops: JsonPatchOp[] = [];
  walk(from, to, '', ops);
  return ops;
}

function walk(a: Json, b: Json, path: string, ops: JsonPatchOp[]): void {
  if (a === b) return;
  if (Array.isArray(a) && Array.isArray(b)) {
    const common = Math.min(a.length, b.length);
    for (let i = 0; i < common; i++) walk(a[i] as Json, b[i] as Json, `${path}/${String(i)}`, ops);
    for (let i = common; i < b.length; i++) {
      ops.push({ op: 'add', path: `${path}/${String(i)}`, value: b[i] as Json });
    }
    for (let i = a.length - 1; i >= b.length; i--) {
      ops.push({ op: 'remove', path: `${path}/${String(i)}` });
    }
    return;
  }
  if (isObject(a) && isObject(b)) {
    for (const key of Object.keys(a)) {
      if (a[key] === undefined) continue;
      const p = `${path}/${escapePointer(key)}`;
      if (!Object.prototype.hasOwnProperty.call(b, key) || b[key] === undefined) {
        ops.push({ op: 'remove', path: p });
      } else {
        walk(a[key], b[key], p, ops);
      }
    }
    for (const key of Object.keys(b)) {
      if (b[key] === undefined) continue;
      if (!Object.prototype.hasOwnProperty.call(a, key) || a[key] === undefined) {
        ops.push({ op: 'add', path: `${path}/${escapePointer(key)}`, value: b[key] });
      }
    }
    return;
  }
  if (typeof a === 'number' && typeof b === 'number' && Object.is(a, b)) return;
  if (typeof a !== 'object' && a === b) return;
  ops.push({ op: 'replace', path, value: b });
}

/**
 * Applies `ops` to `doc` and returns the new document. `doc` is not modified; untouched
 * subtrees are shared with the result. Patches can come from the network, so anything
 * outside the subset `diff` produces (unknown ops, malformed paths or array indexes)
 * throws instead of being guessed at.
 */
export function applyPatch(doc: Json, ops: readonly JsonPatchOp[]): Json {
  let root = doc;
  for (const op of ops) root = applyOne(root, op);
  return root;
}

const ARRAY_INDEX = /^(0|[1-9][0-9]*)$/;

function applyOne(root: Json, op: JsonPatchOp): Json {
  const kind: unknown = op.op; // untrusted: the type is what we expect, not what we got
  if (kind !== 'add' && kind !== 'remove' && kind !== 'replace') {
    throw new Error(`applyPatch: unsupported op "${String(kind)}"`);
  }
  if (typeof op.path !== 'string' || (op.path !== '' && !op.path.startsWith('/'))) {
    throw new Error('applyPatch: a path must be empty or start with "/"');
  }
  if (op.path === '') {
    if (op.op === 'remove') throw new Error('applyPatch: cannot remove the root');
    return op.value;
  }
  const tokens = op.path.split('/').slice(1).map(unescapePointer);
  return setIn(root, tokens, 0, op);
}

function setIn(node: Json, tokens: string[], depth: number, op: JsonPatchOp): Json {
  const token = tokens[depth]!;
  const last = depth === tokens.length - 1;
  if (Array.isArray(node)) {
    const copy = node.slice();
    // RFC 6901: decimal digits without leading zeros, or "-" (one past the end) for add.
    const appending = token === '-' && last && op.op === 'add';
    const index = appending ? copy.length : ARRAY_INDEX.test(token) ? Number(token) : -1;
    // Only add may address one past the end; everything else needs an existing element.
    const end = last && op.op === 'add' ? copy.length : copy.length - 1;
    if (index < 0 || index > end) {
      throw new Error(`applyPatch: bad array index "${token}" in ${op.path}`);
    }
    if (!last) {
      copy[index] = setIn(copy[index] as Json, tokens, depth + 1, op);
      return copy;
    }
    if (op.op === 'add') copy.splice(index, 0, op.value);
    else if (op.op === 'remove') copy.splice(index, 1);
    else copy[index] = op.value;
    return copy;
  }
  if (isObject(node)) {
    const copy: Record<string, Json> = { ...node };
    if (!last) {
      const child = Object.prototype.hasOwnProperty.call(copy, token) ? copy[token] : undefined;
      if (child === undefined) throw new Error(`applyPatch: missing path ${op.path}`);
      setOwn(copy, token, setIn(child, tokens, depth + 1, op));
      return copy;
    }
    if (op.op === 'remove') {
      if (!Object.prototype.hasOwnProperty.call(copy, token)) {
        throw new Error(`applyPatch: missing path ${op.path}`);
      }
      delete copy[token];
    } else {
      setOwn(copy, token, op.value);
    }
    return copy;
  }
  throw new Error(`applyPatch: cannot descend into a primitive at ${op.path}`);
}

/**
 * Sets an own data property. Plain assignment would treat `__proto__` as the prototype
 * setter (wrong result, and prototype pollution from untrusted patches).
 */
function setOwn(target: Record<string, Json>, key: string, value: Json): void {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}
