// End-to-end test of the scaffolder, the RFC 0001 Phase 7 exit criterion in miniature: from
// `create-shoehive` to a playable game, with nothing from the monorepo but the packed
// shoehive tarball.
//
//   1. Build shoehive and pack it into a tarball; build create-shoehive.
//   2. Scaffold the tic-tac-toe template into a temp dir (installing with npm), then run the
//      generated project's typecheck, test and build scripts.
//   3. `npm start` it, check the devtools URL is logged and served, and play a full game in
//      two Playwright browser contexts.
//   4. `npm run dev` it and check the Vite proxy reaches the game server.
//   5. Scaffold the blank template with --no-install, install, typecheck and test it.
//
// Run from the repo root: `pnpm --filter create-shoehive e2e`. Needs network access to the
// npm registry and a Playwright Chromium. E2E_KEEP=1 keeps the temp dir; E2E_VERBOSE=1
// streams every command's output.

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(PKG_DIR, '../..');
const SHOEHIVE_DIR = join(REPO, 'packages/shoehive');
const VERBOSE = process.env.E2E_VERBOSE === '1';
const KEEP = process.env.E2E_KEEP === '1';

// The repo's own Playwright (a dependency of @playwright/test), never a separate install.
const requireFromRepo = createRequire(join(REPO, 'package.json'));
const { chromium } = createRequire(requireFromRepo.resolve('@playwright/test'))('playwright');

const started = Date.now();
const timings = [];
const running = new Set();

/** The environment for commands run in a generated project: no pnpm or npm leftovers. */
function cleanEnv(extra = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(npm_|pnpm_)/i.test(key) || key === 'NODE_ENV' || key === 'INIT_CWD') continue;
    env[key] = value;
  }
  return { ...env, CI: process.env.CI ?? '1', ...extra };
}

async function step(name, fn) {
  const t0 = Date.now();
  process.stdout.write(`- ${name} ... `);
  try {
    const result = await fn();
    const ms = Date.now() - t0;
    timings.push([name, ms]);
    process.stdout.write(`ok (${(ms / 1000).toFixed(1)}s)\n`);
    return result;
  } catch (error) {
    process.stdout.write('FAILED\n');
    throw error;
  }
}

/** Runs a command to completion; throws with its output if it exits non-zero. */
function sh(command, args, { cwd, env = process.env } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', VERBOSE ? 'inherit' : 'pipe', VERBOSE ? 'inherit' : 'pipe'],
    });
    let output = '';
    child.stdout?.on('data', (chunk) => (output += chunk));
    child.stderr?.on('data', (chunk) => (output += chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolvePromise(output);
      else {
        reject(
          new Error(
            `${command} ${args.join(' ')} exited with ${String(code)} in ${cwd}\n${output}`,
          ),
        );
      }
    });
  });
}

/** Starts a long-running command in its own process group, collecting its output. */
function startServer(command, args, { cwd, env }) {
  const child = spawn(command, args, {
    cwd,
    env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  running.add(child);
  const server = { child, output: '' };
  const collect = (chunk) => {
    server.output += chunk;
    if (VERBOSE) process.stdout.write(chunk);
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  child.on('close', () => running.delete(child));
  return server;
}

async function stopServer(server) {
  if (server.child.exitCode !== null || server.child.signalCode !== null) return;
  const closed = new Promise((r) => server.child.once('close', r));
  try {
    process.kill(-server.child.pid, 'SIGTERM');
  } catch {
    return;
  }
  const timer = setTimeout(() => {
    try {
      process.kill(-server.child.pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }, 5_000);
  await closed;
  clearTimeout(timer);
}

async function waitFor(what, check, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function waitForOutput(server, pattern, what) {
  return waitFor(
    `${what}. Output so far:\n${server.output}`,
    () => {
      if (server.child.exitCode !== null) {
        throw new Error(`Server exited (${String(server.child.exitCode)}):\n${server.output}`);
      }
      return pattern.exec(server.output);
    },
    60_000,
  );
}

function freePort() {
  return new Promise((resolvePromise, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolvePromise(port));
    });
  });
}

/** Removes terminal color codes: CI forces color, so test output has them. */
const plain = (text) => stripVTControlCharacters(text);

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

/** Waits until the locator's text is exactly `text`. */
async function expectText(locator, text) {
  let last = '';
  await waitFor(
    `text "${text}" (last seen "${last}")`,
    async () => {
      last = ((await locator.textContent({ timeout: 10_000 })) ?? '').trim();
      return last === text;
    },
    10_000,
  ).catch(() => {
    throw new Error(`Expected text "${text}", last saw "${last}"`);
  });
}

async function expectContains(locator, text) {
  let last = '';
  await waitFor(
    `text containing "${text}"`,
    async () => {
      last = (await locator.textContent({ timeout: 10_000 })) ?? '';
      return last.includes(text);
    },
    10_000,
  ).catch(() => {
    throw new Error(`Expected text containing "${text}", last saw "${last}"`);
  });
}

const LAYOUT = [
  '.gitignore',
  'README.md',
  'package.json',
  'src/game.ts',
  'src/server.ts',
  'test/game.test.ts',
  'tsconfig.json',
  'vite.config.ts',
  'web/App.tsx',
  'web/index.html',
  'web/main.tsx',
  'web/style.css',
];

async function playTicTacToe(browser, baseUrl) {
  const xContext = await browser.newContext();
  const oContext = await browser.newContext();
  try {
    const x = await xContext.newPage();
    await x.goto(baseUrl);
    await x.getByRole('button', { name: 'New game' }).click();
    await waitFor('the table URL', () => /#\/table\/.+/.test(x.url()), 10_000);
    await x.getByRole('button', { name: 'Take a seat' }).click();
    await expectContains(x.getByTestId('seat-0'), '(you)');
    await expectText(x.getByRole('status'), 'Waiting for another player');

    const o = await oContext.newPage();
    await o.goto(x.url());
    await o.getByRole('button', { name: 'Take a seat' }).click();
    await expectContains(o.getByTestId('seat-1'), '(you)');
    await expectText(x.getByRole('status'), 'Your turn');
    await expectText(o.getByRole('status'), 'Waiting for X');

    const moves = [
      [x, o, 0, 'X'],
      [o, x, 1, 'O'],
      [x, o, 4, 'X'],
      [o, x, 2, 'O'],
      [x, o, 8, 'X'],
    ];
    for (const [player, other, cell, mark] of moves) {
      await player.getByRole('button', { name: `cell ${String(cell)}` }).click();
      for (const page of [player, other]) {
        await expectText(page.getByRole('button', { name: `cell ${String(cell)}` }), mark);
      }
    }
    for (const page of [x, o]) {
      await expectText(page.getByRole('status'), 'X wins');
      assert(
        await page.getByRole('button', { name: 'cell 3' }).isDisabled(),
        'the board is disabled after the game ends',
      );
    }
    assert((await x.getByRole('alert').count()) === 0, 'no error is shown');
  } finally {
    await xContext.close();
    await oContext.close();
  }
}

let tmp;
let browser;
try {
  tmp = await mkdtemp(join(tmpdir(), 'create-shoehive-e2e-'));
  console.log(`create-shoehive end-to-end (temp dir ${tmp})`);

  const tarball = await step('build and pack shoehive', async () => {
    await sh('pnpm', ['--filter', 'shoehive', 'build'], { cwd: REPO });
    const packDir = join(tmp, 'pack');
    await mkdir(packDir);
    await sh('pnpm', ['pack', '--pack-destination', packDir], { cwd: SHOEHIVE_DIR });
    const file = readdirSync(packDir).find((f) => f.endsWith('.tgz'));
    assert(file, 'pnpm pack wrote a tarball');
    return join(packDir, file);
  });

  await step('build create-shoehive', () =>
    sh('pnpm', ['--filter', 'create-shoehive', 'build'], { cwd: REPO }),
  );
  const bin = join(PKG_DIR, 'dist/index.js');

  // -- tic-tac-toe ----------------------------------------------------------------------

  const game = join(tmp, 'my-game');
  await step('scaffold tic-tac-toe and install with npm', async () => {
    // stdin is not a TTY, so nothing is asked.
    const out = await sh(
      process.execPath,
      [bin, 'my-game', '--shoehive', `file:${tarball}`, '--package-manager', 'npm'],
      { cwd: tmp, env: cleanEnv() },
    );
    const expected = [
      'Done. Next steps:',
      '',
      '  cd my-game',
      '  npm run dev',
      '',
      'Then open http://localhost:5173 in two browser windows',
    ].join('\n');
    assert(out.includes(expected), `next steps are printed:\n${out}`);
    for (const file of LAYOUT) assert(existsSync(join(game, file)), `${file} exists`);
    assert(existsSync(join(game, 'node_modules/shoehive/package.json')), 'shoehive is installed');
    const pkg = JSON.parse(readFileSync(join(game, 'package.json'), 'utf8'));
    assert(pkg.name === 'my-game', 'package name is my-game');
    assert(pkg.dependencies.shoehive === `file:${tarball}`, 'shoehive spec is the tarball');
    const hasGit = await sh('git', ['--version'], { cwd: tmp }).then(
      () => true,
      () => false,
    );
    if (hasGit) assert(existsSync(join(game, '.git')), 'git init ran');
  });

  await step('tic-tac-toe: npm run typecheck', () =>
    sh('npm', ['run', 'typecheck'], { cwd: game, env: cleanEnv() }),
  );
  await step('tic-tac-toe: npm test', async () => {
    const out = await sh('npm', ['test'], { cwd: game, env: cleanEnv() });
    assert(/Tests\s+5 passed/.test(plain(out)), `5 tests passed:\n${out}`);
  });
  await step('tic-tac-toe: npm run build', async () => {
    await sh('npm', ['run', 'build'], { cwd: game, env: cleanEnv() });
    assert(existsSync(join(game, 'dist-web/index.html')), 'dist-web/index.html was built');
  });

  browser = await chromium.launch();

  await step('tic-tac-toe: npm start, devtools URL, play a full game in two browsers', async () => {
    const port = await freePort();
    const server = startServer('npm', ['start'], {
      cwd: game,
      env: cleanEnv({ PORT: String(port) }),
    });
    try {
      await waitForOutput(server, /Game server listening on port \d+/, 'the server to listen');
      const devtools = await waitForOutput(
        server,
        /Devtools inspector: (http:\/\/localhost:(\d+)\/__shoehive\/)#token=\S+/,
        'the devtools URL',
      );
      assert(devtools[2] === String(port), 'the devtools URL uses the server port');
      const res = await fetch(devtools[1]);
      assert(res.status === 200, `the devtools inspector is served (status ${String(res.status)})`);
      await playTicTacToe(browser, `http://localhost:${String(port)}/`);
    } finally {
      await stopServer(server);
    }
  });

  await step('tic-tac-toe: npm run dev (Vite proxy to the game server)', async () => {
    const serverPort = await freePort();
    const vitePort = await freePort();
    const dev = startServer(
      'npm',
      ['run', 'dev', '--', '--port', String(vitePort), '--strictPort'],
      {
        cwd: game,
        env: cleanEnv({ PORT: String(serverPort) }),
      },
    );
    try {
      await waitForOutput(
        dev,
        new RegExp(
          `Game server listening on port ${String(serverPort)}\\. Play at http://localhost:${String(vitePort)}`,
        ),
        'the game server under Vite',
      );
      await waitForOutput(dev, /Devtools inspector: /, 'the devtools URL');
      await playTicTacToe(browser, `http://localhost:${String(vitePort)}/`);
    } finally {
      await stopServer(dev);
    }
  });

  // -- blank ----------------------------------------------------------------------------

  const blank = join(tmp, 'my-blank');
  await step('scaffold blank with --no-install', async () => {
    const out = await sh(
      process.execPath,
      [
        bin,
        'my-blank',
        '--template',
        'blank',
        '--no-install',
        '--shoehive',
        `file:${tarball}`,
        '--package-manager',
        'npm',
      ],
      { cwd: tmp, env: cleanEnv() },
    );
    assert(
      out.includes('  cd my-blank\n  npm install\n  npm run dev\n'),
      `next steps include the install:\n${out}`,
    );
    for (const file of LAYOUT) assert(existsSync(join(blank, file)), `${file} exists`);
    assert(!existsSync(join(blank, 'node_modules')), 'nothing was installed');
  });
  await step('blank: npm install', () => sh('npm', ['install'], { cwd: blank, env: cleanEnv() }));
  await step('blank: npm run typecheck', () =>
    sh('npm', ['run', 'typecheck'], { cwd: blank, env: cleanEnv() }),
  );
  await step('blank: npm test', async () => {
    const out = await sh('npm', ['test'], { cwd: blank, env: cleanEnv() });
    assert(/Tests\s+3 passed/.test(plain(out)), `3 tests passed:\n${out}`);
  });

  const total = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\ncreate-shoehive end-to-end passed: ${String(timings.length)} steps in ${total}s`);
} catch (error) {
  console.error(`\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const child of running) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
  if (tmp && !KEEP) await rm(tmp, { recursive: true, force: true });
  else if (tmp) console.log(`Kept ${tmp}`);
}
