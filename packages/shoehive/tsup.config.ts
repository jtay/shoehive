import { defineConfig } from 'tsup';

// One entry per public subpath export. Keep in sync with "exports" in package.json (ADR 0002).
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'server/index': 'src/server/index.ts',
    'client/index': 'src/client/index.ts',
    'react/index': 'src/react/index.ts',
    'cards/index': 'src/cards/index.ts',
    'testing/index': 'src/testing/index.ts',
    'devtools/index': 'src/devtools/index.ts',
    'store/memory': 'src/store/memory.ts',
    'store/sqlite': 'src/store/sqlite.ts',
    'store/postgres': 'src/store/postgres.ts',
    'store/redis': 'src/store/redis.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2023',
  treeshake: true,
  // Shared chunks for CJS too, so classes like ShoehiveError have one identity across entries.
  splitting: true,
});
