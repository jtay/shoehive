// Helpers shared by the site's scripts and its build-time integration: where content lives,
// and a small reader for the top-level scalar keys of a page's frontmatter.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const websiteDir = fileURLToPath(new URL('../..', import.meta.url));
export const repoRoot = join(websiteDir, '..');
export const contentDir = join(websiteDir, 'src/content/docs');

/** All files under `dir` (recursively) whose name ends with one of `extensions`. */
export function listFiles(dir: string, extensions: readonly string[]): string[] {
  const out: string[] = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(path, extensions));
    else if (extensions.some((ext) => entry.name.endsWith(ext))) out.push(path);
  }
  return out.sort();
}

/** The top-level `key: value` pairs of a page's frontmatter (scalars only, quotes removed). */
export function readFrontmatter(text: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const data: Record<string, string> = {};
  if (!match?.[1]) return data;
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (!pair?.[1] || pair[2] === undefined || pair[2] === '') continue;
    data[pair[1]] = pair[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return data;
}

export interface TodoPage {
  /** Path relative to the repository root. */
  file: string;
  title: string;
  todo: string;
}

/** Pages that still carry a `todo:` key in their frontmatter: the stubs writers need to fill. */
export function todoPages(): TodoPage[] {
  return listFiles(contentDir, ['.md', '.mdx']).flatMap((path) => {
    const data = readFrontmatter(readFileSync(path, 'utf8'));
    const todo = data['todo'];
    if (todo === undefined) return [];
    return [{ file: relative(repoRoot, path), title: data['title'] ?? '(untitled)', todo }];
  });
}
