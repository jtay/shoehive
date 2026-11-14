import { builtinModules } from 'node:module';
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Entry points that must run in browsers and edge runtimes as well as Node (ADR 0002).
const isomorphicFiles = [
  'packages/shoehive/src/index.ts',
  'packages/shoehive/src/protocol/**/*.ts',
  'packages/shoehive/src/client/**/*.ts',
  'packages/shoehive/src/react/**/*.ts',
  'packages/shoehive/src/cards/**/*.ts',
];

export default defineConfig(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**'] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    files: isomorphicFiles,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*', 'ws', ...builtinModules],
              message: 'Isomorphic entry points must not import Node built-ins or ws (ADR 0002).',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
