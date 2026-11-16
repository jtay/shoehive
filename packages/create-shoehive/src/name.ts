// npm package name rules (the subset that applies to an unscoped or scoped project name):
// at most 214 characters, lowercase, URL-safe, not starting with "." or "_".
const VALID_NAME = /^(?:@[a-z0-9-*~][a-z0-9-*._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const RESERVED = new Set(['node_modules', 'favicon.ico']);

/** Returns why `name` is not a valid npm package name, or `null` if it is. */
export function validatePackageName(name: string): string | null {
  if (name.length === 0) return 'The name is empty.';
  if (name.length > 214) return 'The name is longer than 214 characters.';
  if (name !== name.trim()) return 'The name starts or ends with spaces.';
  if (name.startsWith('.') || name.startsWith('_')) return 'The name starts with "." or "_".';
  if (name.toLowerCase() !== name) return 'The name has uppercase letters.';
  if (RESERVED.has(name)) return `"${name}" is a reserved name.`;
  if (!VALID_NAME.test(name)) {
    return 'Use lowercase letters, digits, "-", "." and "_" (and an optional @scope/).';
  }
  return null;
}

/**
 * Turns a directory name into a valid package name, for example `My Game!` into `my-game`.
 * Returns `''` when nothing usable is left.
 */
export function toValidPackageName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-~._]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-._]+/, '')
    .replace(/-+$/, '')
    .slice(0, 214);
}
