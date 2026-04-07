import * as http from 'http';
import { createGameServer } from './src/index';
import WebSocket from 'ws';

// Helper to wait for a specific message
function waitForMessage(ws: WebSocket, typeFilter: string, condition?: (msg: any) => boolean): Promise<any> {
  return new Promise(resolve => {
    const listener = (data: any) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === typeFilter) {
        if (!condition || condition(msg)) {
          ws.off('message', listener);
          resolve(msg);
        }
      }
    };
    ws.on('message', listener);
  });
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTest() {
  const server = http.createServer();
  const gameServer = createGameServer(server);

  // 1. Setup the Game
  gameServer.gameManager.registerGame({
    id: 'tictactoe',
    name: 'Tic Tac Toe',
    description: 'A game simulation',
    minPlayers: 2,
    maxPlayers: 2,
    defaultSeats: 2,
    maxSeatsPerPlayer: 1,
    options: {
      setupTable: (table: any) => {
        table.setAttribute('board', [null, null, null, null, null, null, null, null, null]);
        table.setAttribute('turn', 0); // seatIndex 0
        table.setAttribute('status', 'waiting');
      }
    }
  });

  gameServer.eventBus.on('table:player:sat', (player: any, table: any, seatIndex: number) => {
    // Check if 2 players are seated
    let playersSeated = 0;
    for (let i = 0; i < 2; i++) {
      if (table.getPlayerAtSeat(i)) playersSeated++;
    }
    if (playersSeated === 2 && table.getAttribute('status') === 'waiting') {
      table.setAttribute('status', 'playing');
      console.log('Server: Match starting, Game status -> playing');
    }
  });

  gameServer.messageRouter.registerCommandHandler('tictactoe:move', (player: any, msg: any) => {
    const table = player.getTable();
    if (!table || table.getAttribute('status') !== 'playing') return;

    let seatIndex = -1;
    for (let i = 0; i < 2; i++) {
      if (table.getPlayerAtSeat(i)?.id === player.id) seatIndex = i;
    }

    if (seatIndex === -1 || table.getAttribute('turn') !== seatIndex) return;

    const board = [...table.getAttribute('board')];
    const { position } = msg.data;

    if (board[position] !== null) return;

    board[position] = seatIndex === 0 ? 'X' : 'O';
    table.setAttribute('board', board);
    console.log(`Server: Player at seat ${seatIndex} played at position ${position}`);

    const winningLines = [
      [0, 1, 2], [3, 4, 5], [6, 7, 8],
      [0, 3, 6], [1, 4, 7], [2, 5, 8],
      [0, 4, 8], [2, 4, 6]
    ];
    let won = false;
    for (const [a, b, c] of winningLines) {
      if (board[a] && board[a] === board[b] && board[a] === board[c]) {
        won = true;
        table.setAttributes({ 'status': 'finished', 'winner': board[a] });
        console.log(`Server: Match finished, Winner is ${board[a]}`);
        break;
      }
    }

    if (!won && !board.includes(null)) {
      table.setAttributes({ 'status': 'finished', 'winner': 'Tie' });
      console.log(`Server: Match tied`);
    } else if (!won) {
      table.setAttribute('turn', seatIndex === 0 ? 1 : 0);
    }
  });

  // 2. Run the simulation
  server.listen(3034, async () => {
    try {
      console.log('Server running on 3034\n---');

      // Player 1 Connects
      const p1 = new WebSocket('ws://localhost:3034');
      const p1State = await waitForMessage(p1, 'player:state');
      const p1Id = p1State.data?.player?.id || p1State.data?.id || p1State.player?.id;
      console.log(`[P1] Connected, ID: ${p1Id}`);

      // Player 1 creates table
      p1.send(JSON.stringify({ action: 'lobby:table:create', gameId: 'tictactoe' }));
      const t1State = await waitForMessage(p1, 'table:state');
      const tableId = t1State.data.id;
      console.log(`[P1] Created Table: ${tableId}`);

      // Player 1 sits
      p1.send(JSON.stringify({ action: 'table:seat:sit', tableId, seatIndex: 0 }));
      await waitForMessage(p1, 'table:state', (m: any) => m.data.seats[0].player !== null);
      console.log(`[P1] Sat at seat 0`);

      // Player 2 Connects
      const p2 = new WebSocket('ws://localhost:3034');
      const p2State = await waitForMessage(p2, 'player:state');
      const p2Id = p2State.data?.player?.id || p2State.data?.id || p2State.player?.id;
      console.log(`[P2] Connected, ID: ${p2Id}`);

      // Player 2 joins Table
      p2.send(JSON.stringify({ action: 'table:join', tableId }));
      await waitForMessage(p2, 'table:state');
      console.log(`[P2] Joined Table: ${tableId}`);

      // Player 2 sits
      p2.send(JSON.stringify({ action: 'table:seat:sit', tableId, seatIndex: 1 }));
      await waitForMessage(p2, 'table:state', (m: any) => m.data.seats[1].player !== null);
      console.log(`[P2] Sat at seat 1`);

      // Wait for server to update status
      await delay(100);

      console.log('\n--- Match Starting ---');
      // P1 plays 0
      p1.send(JSON.stringify({ action: 'tictactoe:move', data: { position: 0 } }));
      await waitForMessage(p2, 'table:state', m => m.data.attributes.board[0] === 'X');
      console.log('[P1] Played 0, P2 acknowledged the state change');

      // P2 plays 3
      p2.send(JSON.stringify({ action: 'tictactoe:move', data: { position: 3 } }));
      await waitForMessage(p1, 'table:state', m => m.data.attributes.board[3] === 'O');
      console.log('[P2] Played 3, P1 acknowledged the state change');

      // P1 plays 1
      p1.send(JSON.stringify({ action: 'tictactoe:move', data: { position: 1 } }));
      await waitForMessage(p2, 'table:state', m => m.data.attributes.board[1] === 'X');
      console.log('[P1] Played 1, P2 acknowledged the state change');

      // P2 plays 4
      p2.send(JSON.stringify({ action: 'tictactoe:move', data: { position: 4 } }));
      await waitForMessage(p1, 'table:state', m => m.data.attributes.board[4] === 'O');
      console.log('[P2] Played 4, P1 acknowledged the state change');

      // P1 plays 2 (Wins)
      p1.send(JSON.stringify({ action: 'tictactoe:move', data: { position: 2 } }));

      const finalStateP1 = await waitForMessage(p1, 'table:state', m => m.data.attributes.status === 'finished');
      const finalStateP2 = await waitForMessage(p2, 'table:state', m => m.data.attributes.status === 'finished');

      console.log('\n--- Final Board ---');
      const board = finalStateP1.data.attributes.board;
      console.log(`${board[0]} | ${board[1]} | ${board[2]}`);
      console.log(`---------`);
      console.log(`${board[3] || ' '} | ${board[4]} | ${board[5] || ' '}`);
      console.log(`---------`);
      console.log(`${board[6] || ' '} | ${board[7] || ' '} | ${board[8] || ' '}`);

      console.log('\nTest completely passed! Both P1 and P2 observed winner:', finalStateP2.data.attributes.winner);

      p1.close();
      p2.close();
      server.close();
      process.exit(0);
    } catch (err) {
      console.error(err);
      process.exit(1);
    }
  });

  setTimeout(() => {
    console.error("Test timeout");
    process.exit(1);
  }, 5000);
}

runTest();
