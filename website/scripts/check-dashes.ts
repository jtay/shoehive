// House style: no em-dash characters anywhere. Fails on U+2014 (or its HTML entities) in any
// text file in the repository that git does not ignore: docs, site content, snippets,
// examples, source comments (they become the API reference) and changesets.
//
//   pnpm --filter @shoehive/website check:dashes          sources
//   pnpm --filter @shoehive/website check:dashes --dist   also the built site (website/dist)

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { listFiles, repoRoot, websiteDir } from '../src/lib/pages';

// The character and its entities, spelled in pieces so this file does not match itself.
const EM_DASH = new RegExp(
  ['\\u2014', '&' + 'mdash;', '&#' + '8212;', '&#x' + '2014;'].join('|'),
  'gi',
);
const TEXT = new Set([
  '.md',
  '.mdx',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.mjs',
  '.cjs',
  '.astro',
  '.json',
  '.yml',
  '.yaml',
  '.css',
  '.html',
  '.txt',
  '.sh',
]);
const SKIP = new Set(['pnpm-lock.yaml']);

function sourceFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out
    .split('\n')
    .filter((f) => f && TEXT.has(extname(f)) && !SKIP.has(f))
    .map((f) => join(repoRoot, f));
}

const files = sourceFiles();
if (process.argv.includes('--dist')) {
  files.push(...listFiles(join(websiteDir, 'dist'), ['.html', '.xml', '.txt']));
}

let found = 0;
for (const file of files) {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue; // deleted but still in the index
  }
  if (!EM_DASH.test(text)) continue;
  EM_DASH.lastIndex = 0;
  text.split('\n').forEach((line, i) => {
    for (const match of line.matchAll(EM_DASH)) {
      found++;
      console.error(
        `${relative(repoRoot, file)}:${String(i + 1)}:${String(match.index + 1)}: em-dash: use a colon, comma, parentheses or a new sentence`,
      );
    }
  });
}

if (found > 0) {
  console.error(`\ncheck-dashes: ${String(found)} em-dash(es) found.`);
  process.exit(1);
}
console.log(`check-dashes: OK. No em-dashes in ${String(files.length)} files.`);
