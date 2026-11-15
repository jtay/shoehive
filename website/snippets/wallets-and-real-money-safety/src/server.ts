// Wiring a wallet into the server (/how-to/wallets-and-real-money-safety/).
import { createServer } from 'shoehive/server';
import { ticTacToe } from '../../quick-start/src/game';
import { ledgerWallet, type Ledger } from './ledger-wallet';

declare const ledger: Ledger; // your database
declare function verifyJwt(token: string): Promise<{ sub: string; name: string }>;

// #region server
const shoehive = createServer({
  games: [ticTacToe],
  wallet: ledgerWallet(ledger),
  // Real money needs real identities: guest ids are bearer tokens.
  auth: async (request) => {
    const token = new URL(request.url ?? '/', 'http://x').searchParams.get('token');
    if (!token) return null; // refused with HTTP 401
    const claims = await verifyJwt(token);
    return { id: claims.sub, name: claims.name };
  },
});

// A deferred commit, release or credit that still failed after retries.
shoehive.on('wallet:error', ({ table, op, error }) => {
  console.error('RECONCILE', { table, op, error });
});
// #endregion server
