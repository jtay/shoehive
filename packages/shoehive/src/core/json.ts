/** A JSON value. Game state, views, action inputs and results must all be JSON (ADR 0005). */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/**
 * Returns the JSON-pointer-style path of the first non-JSON value inside `value`, or
 * `null` when the whole value is plain JSON. Used by dev-mode checks (ADRs 0003, 0005).
 */
export function findNonJson(value: unknown, path = ''): { path: string; reason: string } | null {
  if (value === null) return null;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return null;
    case 'number':
      return Number.isFinite(value)
        ? null
        : { path: path || '/', reason: `non-finite number ${String(value)}` };
    case 'object': {
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          if (!(i in value) || value[i] === undefined) {
            return { path: `${path}/${String(i)}`, reason: 'undefined or empty slot in array' };
          }
          const found = findNonJson(value[i], `${path}/${String(i)}`);
          if (found) return found;
        }
        return null;
      }
      const proto: unknown = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        const name = (value as { constructor?: { name?: string } }).constructor?.name ?? 'unknown';
        return {
          path: path || '/',
          reason: `instance of ${name} (only plain objects are allowed)`,
        };
      }
      for (const [key, child] of Object.entries(value)) {
        if (child === undefined) continue; // dropped by JSON serialisation, harmless in objects
        const found = findNonJson(child, `${path}/${escapePointer(key)}`);
        if (found) return found;
      }
      return null;
    }
    default:
      return { path: path || '/', reason: `${typeof value} is not JSON` };
  }
}

/** Escapes a key for use in a JSON pointer (RFC 6901). */
export function escapePointer(key: string): string {
  return key.replace(/~/g, '~0').replace(/\//g, '~1');
}

/** Unescapes a JSON pointer token (RFC 6901). */
export function unescapePointer(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

/** Deep structural equality for JSON values. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!jsonEqual(a[i], b[i])) return false;
    return true;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao).filter((k) => ao[k] !== undefined);
  const bk = Object.keys(bo).filter((k) => bo[k] !== undefined);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!Object.prototype.hasOwnProperty.call(bo, k) || !jsonEqual(ao[k], bo[k])) return false;
  }
  return true;
}
