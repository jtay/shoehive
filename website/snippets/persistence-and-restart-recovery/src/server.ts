// A server whose tables survive a restart (/how-to/persistence-and-restart-recovery/).
import { createServer } from 'shoehive/server';
import { sqliteStore } from 'shoehive/store/sqlite';
import { ticTacToe } from '../../quick-start/src/game';

// #region server
const shoehive = createServer({
  games: [ticTacToe],
  store: sqliteStore({ file: './shoehive.db' }),
  snapshotEvery: 100, // also on every phase change and when a table ends
  reconnectGraceMs: 60_000, // how long recovered players have to come back
});

shoehive.on('table:recovered', ({ table }) => {
  console.log(`recovered ${table}`);
});
shoehive.on('table:recovery-failed', ({ table, reason }) => {
  // The table stays in the store, closed to players. Fix the cause, then restart.
  console.error(`could not recover ${table}: ${reason}`);
});
// #endregion server

// #region shutdown
// Graceful by default: queues drain and every table gets a final snapshot.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shoehive.close().then(() => process.exit(0));
  });
}
// #endregion shutdown

await shoehive.listen({ port: 3000 });
