// Serves the built web app (dist-web/) and the Shoehive WebSocket endpoint on one port.
// Run with `pnpm build:web && pnpm start`, then open http://localhost:3102 in two browsers.

import { readFile, stat } from 'node:fs/promises';
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'shoehive/server';
import { quiz } from './game';

const PORT = Number(process.env['PORT'] ?? 3102);
const WEB_ROOT = fileURLToPath(new URL('../dist-web', import.meta.url));

// Resume tokens are signed with SHOEHIVE_SECRET. Without it, createServer() picks a random
// secret outside production (tokens then do not survive a restart) and refuses to start in
// production. Never hard-code a secret: anyone who reads it can sign a token for any guest.
const secret = process.env['SHOEHIVE_SECRET'];

// Devtools in development only (ADR 0011): the inspector URL, with its token, is logged at
// startup. SHOEHIVE_DEVTOOLS_TOKEN fixes the token (the end-to-end tests use it).
const devtoolsToken = process.env['SHOEHIVE_DEVTOOLS_TOKEN'];
const devtools =
  process.env['NODE_ENV'] === 'production'
    ? false
    : { enabled: true, ...(devtoolsToken ? { token: devtoolsToken } : {}) };

const shoehive = createServer({ games: [quiz], devtools, ...(secret ? { secret } : {}) });

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
    console.error('[quiz] static handler failed', error);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});

await shoehive.attach(http);
http.listen(PORT, () => {
  console.log(`[quiz] http://localhost:${String(PORT)} (WebSocket at /shoehive)`);
});

const shutdown = (): void => {
  void shoehive.close().finally(() => {
    http.close();
    process.exit(0);
  });
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
