# create-shoehive

Creates a new [Shoehive](https://shoehive.jtay.co.uk) game: a game server, a React app and
tests, ready to play.

```sh
npm create shoehive@latest my-game
cd my-game
npm run dev
```

Then open http://localhost:5173. It also works with `pnpm create shoehive`, `yarn create shoehive`
and `bun create shoehive`.

## Options

With npm, put options after `--`, for example `npm create shoehive@latest my-game -- --template blank`.

| Option                     | What it does                                                     |
| -------------------------- | ---------------------------------------------------------------- |
| `-t, --template <name>`    | `tic-tac-toe` (default) or `blank`, a minimal one-action game    |
| `--package-manager <name>` | `npm`, `pnpm`, `yarn` or `bun` (default: the one running this)   |
| `--no-install`             | Do not install dependencies                                      |
| `--no-git`                 | Do not run `git init`                                            |
| `--shoehive <spec>`        | Version spec for `shoehive` (default: this release, as `^x.y.z`) |
| `-y, --yes`                | Never prompt                                                     |

Without a directory it asks for one (default `my-game`), unless stdin is not a terminal or
`--yes` is given.

The generated project has `dev`, `test`, `typecheck`, `build` and `start` scripts. Its
README explains each one. Start with the tutorial at
https://shoehive.jtay.co.uk/tutorials/tic-tac-toe/.
