// Serves the built web app (dist-web/) and the Shoehive WebSocket endpoint on one port.
// Run with `pnpm build:web && pnpm start`, then open http://localhost:3104 in two browsers.

import { readFile, stat } from 'node:fs/promises';
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, MemoryWallet } from 'shoehive/server';
import { holdem } from './game';

const PORT = Number(process.env['PORT'] ?? 3104);
const WEB_ROOT = fileURLToPath(new URL('../dist-web', import.meta.url));

// Outside production a fixed dev secret keeps resume tokens valid across restarts.
// In production createServer() refuses to start without SHOEHIVE_SECRET.
const secret =
  process.env['SHOEHIVE_SECRET'] ??
  (process.env['NODE_ENV'] === 'production' ? undefined : 'holdem-dev-secret-not-for-production');

const shoehive = createServer({
  games: [holdem],
  wallet: new MemoryWallet({ startingBalance: 1000 }),
  ...(secret ? { secret } : {}),
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
  // Unknown paths fall back to index.html so the app can route them.
  const file = (await isFile(requested)) ? requested : join(WEB_ROOT, 'index.html');
  let body: Buffer;
  try {
    body = await readFile(file);
  } catch {
    res
      .writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
      .end('The web app is not built. Run `pnpm build:web` first.\n');
    return;
  }
  res.writeHead(200, {
    'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
    'content-length': body.length,
    // Vite fingerprints everything under assets/, so it can be cached for good.
    'cache-control': file.includes(`${sep}assets${sep}`)
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

const http = createHttpServer((req, res) => {
  serveStatic(req, res).catch((error: unknown) => {
    console.error('[holdem] static handler failed', error);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});

await shoehive.attach(http);
http.listen(PORT, () => {
  console.log(`[holdem] http://localhost:${String(PORT)} (WebSocket at /shoehive)`);
});

const shutdown = (): void => {
  void shoehive.close().finally(() => {
    http.close();
    process.exit(0);
  });
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
