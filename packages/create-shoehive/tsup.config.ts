import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

// The generated project depends on the shoehive version this scaffolder is built (and so
// published) with. The changesets "fixed" group keeps both packages on the same version.
const versionOf = (path: string): string =>
  (JSON.parse(readFileSync(path, 'utf8')) as { version: string }).version;

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  clean: true,
  // One self-contained file: no runtime dependencies.
  splitting: false,
  banner: { js: '#!/usr/bin/env node' },
  define: {
    __SHOEHIVE_VERSION__: JSON.stringify(versionOf('../shoehive/package.json')),
    __CREATE_SHOEHIVE_VERSION__: JSON.stringify(versionOf('./package.json')),
  },
});
