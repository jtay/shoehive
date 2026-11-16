# Devtools

`shoehive/devtools` is an inspector for a running server: every table's raw state and
engine state, every seat's view side by side with the spectator's, the action log and
rejected actions, sessions and connections, plus time travel, forks and fixture export.
Its security model is ADR 0011.

## Turning it on

```ts
import type { AnyGame } from 'shoehive';
declare const games: AnyGame[];
// ---cut---
import { createServer } from 'shoehive/server';

const shoehive = createServer({ games, devtools: true });
await shoehive.listen({ port: 3000 });
```

On startup the server logs the inspector URL once, with a fresh token in the fragment:

```
Devtools inspector: http://127.0.0.1:3000/__shoehive/#token=4f1c...
```

Open it. The token stays in the fragment (browsers never send it in a request line) and the
page sends it as the first message on the devtools socket.

- `devtools: true` works only when `NODE_ENV !== 'production'`. In production it is
  ignored with a warning, and nothing is mounted or even imported.
- Only this machine is served: the client must connect from a loopback address, directly
  (a request relayed by a proxy, with `X-Forwarded-For` or `Forwarded`, is refused), and the
  address bar must say `localhost`, an IP address, or a host listed in the server's `origins`
  option. Any other host name gets a 404, so a web page cannot reach the inspector by pointing
  its own domain at 127.0.0.1 (DNS rebinding). Running in a container, on a remote dev box or
  behind a proxy? Pass `{ enabled: true, allowRemote: true }`, keep the token secret, and use
  TLS: the token travels in the first socket message.
- Pass a fixed `token` (32 characters or more) if you want a stable URL across restarts.
- `path` moves the inspector (default `/__shoehive`; its socket is `<path>/ws`).

| Option              | Default         | Meaning                                   |
| ------------------- | --------------- | ----------------------------------------- |
| `enabled`           |                 | turn it on                                |
| `token`             | generated       | required in production; 32+ characters    |
| `path`              | `'/__shoehive'` | HTTP path; the socket is `<path>/ws`      |
| `allowRemote`       | `false`         | serve non-loopback clients                |
| `allowInProduction` | `false`         | allow it when `NODE_ENV === 'production'` |

### With your own HTTP server

`attach(http)` routes the devtools paths ahead of your app's `request` handler and leaves
every other request to it. If your framework owns dispatch, or you add `request` listeners
after `attach()`, route explicitly:

```ts
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { ShoehiveServer } from 'shoehive/server';
declare const http: Server;
declare const shoehive: ShoehiveServer;
declare function app(req: IncomingMessage, res: ServerResponse): void;
// ---cut---
http.on('request', (req, res) => {
  if (shoehive.devtools?.handleRequest(req, res)) return;
  app(req, res);
});
```

### In production

Only for a short, deliberate debugging session:

```ts
import type { AnyGame } from 'shoehive';
declare const games: AnyGame[];
// ---cut---
import { createServer } from 'shoehive/server';

const token = process.env.DEVTOOLS_TOKEN;
if (!token) throw new Error('Set DEVTOOLS_TOKEN (32 characters or more)');

createServer({ games, devtools: { enabled: true, allowInProduction: true, token } });
```

Without `allowInProduction` and a token of at least 32 characters, `createServer` throws.
The startup log says devtools is live. Forks are refused in production. Remember that the
inspector shows raw state (every hidden card) and the RNG seed.

## What it shows

Against live tables the inspector is **read-only**: there is no way to act, edit state,
move seats, fire timers or kick players from it.

- **Tables**: status, revision, seats, connections; forks are badged `dev`.
- **State and engine state** as JSON trees, with what changed since the previous revision
  highlighted.
- **Views**: what each seated player and a spectator receive, computed by the same `view()`
  call the sync uses, so you can check that nobody sees what they should not.
- **Log and diagnostics**: every entry with its time, and recent rejected actions with
  their error codes.
- **Sessions and connections.**

## Time travel and forks

Drag the scrubber, or step back and forward, to see the table at any revision. Each step
replays the stored log into a copy (no store writes, a fresh in-memory wallet); the live
table is never paused or touched.

**Fork** turns the copy at the current revision into a dev table (`dev_...`): not saved,
not listed in the lobby, with an in-memory wallet. The original players can join it from
their normal client and play on from that point. A fork's wallet starts from each player's
last recorded balance; money held by a reservation before the fork is not modelled.

## Export as a test fixture

**Export** downloads the log up to the current revision as a fixture: player ids become
`p0`, `p1`... and names are replaced, but the RNG seed is kept, because the fixture cannot
replay without it. A fixture from a production table therefore reveals that table's cards:
treat it as a secret.

Player ids are also replaced inside action inputs and table options, unless the game then
replays differently (for example because it checks what an id looks like); the export
warning says when they were kept. Every fixture keeps free text in inputs such as chat, the
table id, entry timestamps and the wallet balances the game read.

Replay it in a test with `replayFixture` from `shoehive/testing`. It checks the game, its
version and the exported state, and returns a live test table at the last entry:

```ts nocheck
import { expect, it } from 'vitest';
import { replayFixture, type Fixture } from 'shoehive/testing';
import { holdem } from '../src/game';
import fixture from './fixtures/split-pot.json';

it('splits the odd chip left of the button', async () => {
  const t = await replayFixture(holdem, fixture as Fixture);
  await t.act(2, 'call');
  expect(t.state.seats[3].stack).toBe(141);
});
```

If the game's rules changed since the export, `replayFixture` throws rather than replaying
differently; bump the game's `version` and re-export, or keep the old fixture as a record
of the old behaviour.
