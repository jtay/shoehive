import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const src = (path: string) => here(`../../packages/shoehive/src/${path}`);
const SERVER_PORT = Number(process.env['PORT'] ?? 3101);

export default defineConfig({
  root: here('./web'),
  plugins: [react()],
  resolve: {
    // Like vitest and tsconfig: the examples run against the source, not the built package.
    alias: [
      { find: /^shoehive$/, replacement: src('index.ts') },
      { find: /^shoehive\/(.*)$/, replacement: src('$1/index.ts') },
    ],
    dedupe: ['react', 'react-dom'],
  },
  build: { outDir: here('./dist-web'), emptyOutDir: true },
  // `pnpm dev`: Vite serves the app with hot reload and proxies the socket to `pnpm start`.
  server: {
    proxy: { '/shoehive': { target: `ws://localhost:${String(SERVER_PORT)}`, ws: true } },
  },
});
