// @ts-check
import { fileURLToPath } from 'node:url';
import { satteri } from '@astrojs/markdown-satteri';
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import starlightTypeDoc, { typeDocSidebarGroup } from 'starlight-typedoc';
import { todoReport } from './src/lib/todo-report.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const pkg = (path) => `../packages/shoehive/src/${path}`;

// Every public subpath of the `shoehive` package (package.json "exports"). Keep in sync with
// packages/shoehive/tsup.config.ts; scripts/typedoc-module-names.mjs names each module after it.
const apiEntryPoints = [
  'index.ts',
  'server/index.ts',
  'client/index.ts',
  'react/index.ts',
  'cards/index.ts',
  'testing/index.ts',
  'devtools/index.ts',
  'store/memory.ts',
  'store/sqlite.ts',
  'store/postgres.ts',
  'store/redis.ts',
].map(pkg);

export default defineConfig({
  site: 'https://shoehive.jtay.co.uk',
  trailingSlash: 'ignore',
  markdown: {
    // The house style forbids em-dashes, so never turn `---` or `--` into typographic dashes.
    processor: satteri({ features: { smartPunctuation: false } }),
  },
  vite: {
    // Read by src/lib/snippets.ts (through the <Snippet> component) to find files to import.
    define: { __SHOEHIVE_REPO_ROOT__: JSON.stringify(repoRoot) },
  },
  integrations: [
    starlight({
      title: 'Shoehive',
      description:
        'Build multiplayer card, casino, board and party games in TypeScript. You write the rules; Shoehive handles seats, sync, secrets, reconnects and persistence.',
      logo: { src: './src/assets/logo.png', alt: '' },
      favicon: '/favicon/favicon.svg',
      head: [
        { tag: 'link', attrs: { rel: 'icon', href: '/favicon/favicon.ico', sizes: '48x48' } },
        {
          tag: 'link',
          attrs: { rel: 'apple-touch-icon', href: '/favicon/apple-touch-icon.png' },
        },
        { tag: 'link', attrs: { rel: 'manifest', href: '/favicon/site.webmanifest' } },
      ],
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/jtay/shoehive' }],
      editLink: { baseUrl: 'https://github.com/jtay/shoehive/edit/main/website/' },
      customCss: ['./src/styles/theme.css'],
      components: { Banner: './src/components/Banner.astro' },
      plugins: [
        starlightTypeDoc({
          entryPoints: apiEntryPoints,
          tsconfig: './tsconfig.typedoc.json',
          output: 'reference/api',
          sidebar: { label: 'API', collapsed: true },
          typeDoc: {
            plugin: ['./scripts/typedoc-module-names.mjs'],
            name: 'API reference',
            excludeExternals: true,
            // Module pages at /reference/api/shoehive/server/ rather than .../server/readme/.
            entryFileName: 'index',
            sourceLinkTemplate: 'https://github.com/jtay/shoehive/blob/main/{path}#L{line}',
            gitRevision: 'main',
          },
        }),
      ],
      sidebar: [
        {
          label: 'Start',
          items: ['start/why-shoehive', 'start/quick-start', 'start/six-concepts'],
        },
        { label: 'Tutorials', items: [{ autogenerate: { directory: 'tutorials' } }] },
        {
          label: 'How-to',
          collapsed: true,
          items: [{ autogenerate: { directory: 'how-to' } }],
        },
        {
          label: 'Concepts',
          collapsed: true,
          items: [{ autogenerate: { directory: 'concepts' } }],
        },
        {
          label: 'Reference',
          items: [
            'reference/config',
            'reference/error-codes',
            'reference/protocol',
            'reference/stores',
            'reference/devtools',
            'reference/benchmarks',
            'reference/changelog',
            typeDocSidebarGroup,
          ],
        },
        {
          label: 'Contributing',
          collapsed: true,
          items: [
            'contributing/architecture',
            'contributing/writing-docs',
            'contributing/release-process',
            {
              label: 'ADRs',
              collapsed: true,
              items: [{ autogenerate: { directory: 'contributing/adr' } }],
            },
            {
              label: 'RFCs',
              collapsed: true,
              items: [{ autogenerate: { directory: 'contributing/rfc' } }],
            },
          ],
        },
      ],
    }),
    todoReport(),
  ],
});
