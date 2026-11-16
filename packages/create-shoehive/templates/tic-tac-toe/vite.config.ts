import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

/** The game server's port (src/server.ts). The Vite dev server proxies /shoehive to it. */
const SERVER_PORT = Number(process.env.PORT ?? 3000);

/**
 * Makes `npm run dev` one command: while the Vite dev server runs, this also runs the game
 * server (`tsx watch src/server.ts`), which restarts whenever a file it imports changes.
 */
function gameServer(): Plugin {
  // One devtools token per `npm run dev`, so an open inspector survives server restarts.
  const devtoolsToken =
    process.env.SHOEHIVE_DEVTOOLS_TOKEN ?? randomBytes(32).toString('base64url');
  let child: ChildProcess | undefined;
  const stop = (): void => {
    child?.kill();
    child = undefined;
  };
  return {
    name: 'game-server',
    // Dev server only: not for `vite build`, and not when Vitest loads this config.
    apply: (_config, { command }) => command === 'serve' && !process.env.VITEST,
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        const address = server.httpServer?.address() as AddressInfo | null;
        const tsx = createRequire(import.meta.url).resolve('tsx/cli');
        child = spawn(
          process.execPath,
          [tsx, 'watch', '--clear-screen=false', here('./src/server.ts')],
          {
            stdio: 'inherit',
            env: {
              ...process.env,
              PORT: String(SERVER_PORT),
              SHOEHIVE_DEVTOOLS_TOKEN: devtoolsToken,
              ...(address ? { WEB_URL: `http://localhost:${String(address.port)}` } : {}),
            },
          },
        );
      });
      server.httpServer?.once('close', stop);
      process.once('exit', stop);
    },
  };
}

export default defineConfig({
  // The web app lives in web/; `npm run build` writes it to dist-web/ for src/server.ts.
  root: here('./web'),
  plugins: [react(), gameServer()],
  build: { outDir: here('./dist-web'), emptyOutDir: true },
  server: {
    proxy: { '/shoehive': { target: `ws://localhost:${String(SERVER_PORT)}`, ws: true } },
  },
  // `npm test` runs the game's tests in test/ with Vitest (no browser needed).
  test: { root: here('.'), include: ['test/**/*.test.ts'] },
});
