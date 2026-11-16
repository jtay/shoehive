// Reads code for the <Snippet> component (and for scripts/check-snippets.ts, which checks
// every <Snippet> reference on the site resolves). Only files that are type-checked
// elsewhere may be imported, so a snippet on the site can never drift from code that compiles:
//
// - examples/**                  type-checked and tested by `pnpm check` (each example's tsconfig)
// - website/snippets/**          type-checked by `pnpm --filter @shoehive/website typecheck`
// - packages/create-shoehive/**  the scaffolder's own templates, checked by its package

import { readFileSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';

export const SNIPPET_ROOTS = ['examples/', 'website/snippets/', 'packages/create-shoehive/'];

// `// #region name`, `/* #region name */` and `{/* #region name */}` (JSX), plus `#endregion`.
const REGION_LINE = /^\s*(?:\{\s*)?(?:\/\/|\/\*|#|<!--)\s*#(region|endregion)\b\s*([\w-]*)/;

const LANGS: Record<string, string> = {
  '.ts': 'ts',
  '.mts': 'ts',
  '.cts': 'ts',
  '.tsx': 'tsx',
  '.js': 'js',
  '.mjs': 'js',
  '.jsx': 'jsx',
  '.json': 'json',
  '.css': 'css',
  '.html': 'html',
  '.sh': 'sh',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.md': 'md',
};

export interface Snippet {
  code: string;
  lang: string;
  /** The path to show above the code: relative to the example or snippet project. */
  title: string;
}

export class SnippetError extends Error {
  override readonly name = 'SnippetError';
}

/** Lines between `#region name` and its `#endregion`, dedented, with nested markers removed. */
export function extractRegion(source: string, region: string | undefined, file: string): string {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  let selected: string[];
  if (region === undefined) {
    selected = lines;
  } else {
    const start = lines.findIndex((line) => {
      const m = REGION_LINE.exec(line);
      return m?.[1] === 'region' && m[2] === region;
    });
    if (start === -1) {
      throw new SnippetError(`${file}: no "#region ${region}" marker`);
    }
    let depth = 0;
    let end = -1;
    for (let i = start + 1; i < lines.length; i++) {
      const m = REGION_LINE.exec(lines[i] ?? '');
      if (m?.[1] === 'region') depth++;
      if (m?.[1] === 'endregion') {
        if (depth === 0) {
          end = i;
          break;
        }
        depth--;
      }
    }
    if (end === -1) throw new SnippetError(`${file}: "#region ${region}" has no #endregion`);
    selected = lines.slice(start + 1, end);
  }
  const kept = selected.filter((line) => !REGION_LINE.test(line));
  while (kept.length > 0 && kept[0]?.trim() === '') kept.shift();
  while (kept.length > 0 && kept.at(-1)?.trim() === '') kept.pop();
  const indent = Math.min(
    ...kept.filter((l) => l.trim() !== '').map((l) => /^ */.exec(l)?.[0].length ?? 0),
  );
  return kept.map((line) => line.slice(Number.isFinite(indent) ? indent : 0)).join('\n');
}

/** Checks `file` is allowed and returns its absolute path. */
export function resolveSnippetPath(repoRoot: string, file: string): string {
  const clean = normalize(file).split(sep).join('/');
  if (clean.startsWith('../') || !SNIPPET_ROOTS.some((root) => clean.startsWith(root))) {
    throw new SnippetError(
      `<Snippet file="${file}">: snippets must come from ${SNIPPET_ROOTS.join(', ')} (paths are relative to the repository root)`,
    );
  }
  return join(repoRoot, clean);
}

function defaultTitle(file: string): string {
  const parts = file.split('/');
  // examples/<name>/src/game.ts -> src/game.ts; website/snippets/<topic>/src/x.ts -> src/x.ts
  if (parts[0] === 'examples') return parts.slice(2).join('/');
  if (parts[0] === 'website') return parts.slice(3).join('/');
  return parts.slice(2).join('/');
}

export function readSnippet(repoRoot: string, file: string, region?: string): Snippet {
  const path = resolveSnippetPath(repoRoot, file);
  let source: string;
  try {
    source = readFileSync(path, 'utf8');
  } catch {
    throw new SnippetError(`<Snippet file="${file}">: file not found`);
  }
  return {
    code: extractRegion(source, region, file),
    lang: LANGS[extname(path)] ?? 'txt',
    title: defaultTitle(file),
  };
}
