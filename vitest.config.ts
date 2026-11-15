import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (path: string) =>
  fileURLToPath(new URL(`./packages/shoehive/src/${path}`, import.meta.url));

export default defineConfig({
  resolve: {
    // Examples and tests run against the source, not the built package.
    alias: [
      { find: /^shoehive$/, replacement: src('index.ts') },
      { find: /^shoehive\/(.*)$/, replacement: src('$1/index.ts') },
    ],
  },
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'examples/*/test/**/*.test.ts',
      // The game tests that create-shoehive ships in each template.
      'packages/create-shoehive/templates/*/test/**/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      reporter: ['text', 'html'],
    },
  },
});
