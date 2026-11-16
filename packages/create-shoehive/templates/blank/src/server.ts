// The game server: the Shoehive WebSocket endpoint at /shoehive, plus the built web app
// (dist-web/) on the same port.
//
// - `npm run dev` starts this file in watch mode next to the Vite dev server, which serves
//   the app with hot reload and proxies /shoehive here (see vite.config.ts).
// - `npm run build && npm start` serves everything from here, on http://localhost:3000.

import { readFile, stat } from 'node:fs/promises';
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'shoehive/server';
import { game } from './game';

const PORT = Number(process.env.PORT ?? 3000);
const WEB_ROOT = fileURLToPath(new URL('../dist-web', import.meta.url));
const dev = process.env.NODE_ENV !== 'production';

const shoehive = createServer({
  games: [game],
  // Signs guest resume tokens, so players keep their seats across reloads and restarts.
  // `npm run dev` sets a random SHOEHIVE_SECRET for the session (see vite.config.ts). In
  // production, set your own (32 characters or more): createServer() refuses to start
  // without it. Never put one in code: whoever knows it can sign in as any guest.
  secret: process.env.SHOEHIVE_SECRET,
  // The devtools inspector, in development only. Its URL (with a token) is logged at startup.
  // Under `npm run dev` the token stays the same when this server restarts.
  devtools: dev && { enabled: true, token: process.env.SHOEHIVE_DEVTOOLS_TOKEN },
});

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** Serves dist-web/. Unknown paths get index.html, so the app can route them. */
async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' }).end();
    return;
  }
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  const requested = resolve(join(WEB_ROOT, pathname));
  if (requested !== WEB_ROOT && !requested.startsWith(WEB_ROOT + sep)) {
    res.writeHead(404).end();
    return;
  }
  const file = (await isFile(requested)) ? requested : join(WEB_ROOT, 'index.html');
  let body: Buffer;
  try {
    body = await readFile(file);
  } catch {
    res
      .writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
      .end(
        'The web app is not built yet. Run the build script first, or use the dev script and open the URL it prints.\n',
      );
    return;
  }
  res.writeHead(200, {
    'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
    'content-length': body.length,
    // Vite fingerprints everything under assets/, so it can be cached for good.
    'cache-control': file.includes(`${sep}assets${sep}`)
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
    // Never sniff a type other than the one sent, and never be framed by another site
    // (clickjacking a game's buttons).
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'content-security-policy': "frame-ancestors 'none'",
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

const http = createHttpServer((req, res) => {
  serveStatic(req, res).catch((error: unknown) => {
    console.error('Static file handler failed', error);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});

await shoehive.attach(http);
http.listen(PORT, () => {
  // Under `npm run dev`, vite.config.ts sets WEB_URL to the Vite dev server's address.
  const url = process.env.WEB_URL ?? `http://localhost:${String(PORT)}`;
  console.log(`Game server listening on port ${String(PORT)}. Play at ${url}`);
});

const shutdown = (): void => {
  void shoehive.close().finally(() => {
    http.close();
    process.exit(0);
  });
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
