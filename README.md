# Shoehive

**Build multiplayer card, casino, board and party games. You write the rules; Shoehive handles seats, sync, secrets, reconnects and persistence.**

> **Status: v1 is being rebuilt from the ground up.** Nothing on `main` is usable yet. The last 0.x
> release is tagged `v0.10.0-legacy`. Follow the plan in
> [RFC 0001](docs/rfc/0001-shoehive-v1-rebuild.md) and the [roadmap](docs/rfc/0001-shoehive-v1-rebuild.md#12-roadmap).

## What v1 will look like

```ts
import { defineGame, reject } from 'shoehive';
import { z } from 'zod';

export const ticTacToe = defineGame({
  id: 'tic-tac-toe',
  name: 'Tic Tac Toe',
  seats: { min: 2, max: 2 },
  setup: () => ({ board: Array<'X' | 'O' | null>(9).fill(null) }),
  turns: { order: 'round-robin' },
  actions: {
    place: {
      input: z.object({ cell: z.number().int().min(0).max(8) }),
      run({ state, seat, input, ctx }) {
        if (ctx.turn.seat !== seat) reject('NOT_YOUR_TURN');
        if (state.board[input.cell]) reject('CELL_TAKEN');
        state.board[input.cell] = seat === 0 ? 'X' : 'O';
        ctx.turn.next();
      },
    },
  },
});
```

```ts
import { createServer } from 'shoehive/server';

await createServer({ games: [ticTacToe] }).listen({ port: 3000 });
```

- **Typed end to end.** Action inputs and views are inferred from your game, all the way to `useTable()` in React.
- **Hidden information built in.** Clients only ever receive what your `view()` lets each seat see.
- **Turns and rounds.** Turn-based games and round-based simultaneous play (quizzes, buzzers).
- **Reconnects and restarts.** Guest sessions with resume tokens; tables survive a server restart (memory, SQLite, Postgres, Redis).
- **Deterministic.** Seeded randomness and a recorded action log power tests, replays and devtools time travel.
- **Test without sockets.** `createTestTable(game)` runs your rules with a fake clock.

## Repository layout

| Path                | What                                                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `packages/shoehive` | The `shoehive` npm package: `shoehive`, `shoehive/server`, `/client`, `/react`, `/cards`, `/testing`, `/devtools`, `/store/*` |
| `examples/`         | Tic-tac-toe, quiz, blackjack and Texas Hold'em (from Phase 1 onwards)                                                         |
| `docs/rfc`          | Plans and proposals                                                                                                           |
| `docs/adr`          | Architecture decision records                                                                                                 |
| `docs/reference`    | Specifications, starting with the [wire protocol](docs/reference/protocol.md)                                                 |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues: see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
