import * as http from 'http';
import { createGameServer, AuthModule, ServerTransportModule } from '../index';
import { BasicServerTransportModule } from '../transport/implementations/BasicServerTransportModule';

// Create an HTTP server
const server = http.createServer();

// Implement the AuthModule
class SimpleAuthModule implements AuthModule {
  async authenticatePlayer(request: http.IncomingMessage): Promise<string | null> {
    // In a real implementation, you would verify tokens, check cookies, etc.
    // For this example, we'll simply extract a user ID from the query string
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    const userId = url.searchParams.get('userId');
    
    return userId; // Return the user ID if present, null if not
  }
}

// Create instances of the modules
const authModule = new SimpleAuthModule();
const serverTransportModule = new BasicServerTransportModule();

// Set up some initial balances for testing
if (serverTransportModule instanceof BasicServerTransportModule) {
  serverTransportModule.setPlayerBalance('player1', 1000);
  serverTransportModule.setPlayerBalance('player2', 500);
}

// Create the game server
const gameServer = createGameServer(server, authModule, serverTransportModule);

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Game server running on port ${PORT}`);
  console.log(`Connect with WebSocket using ?userId=player1 or ?userId=player2 in the URL`);
});

// Example of using server transport module in game logic
// This might be used in your game actions or rules
async function handleBet(playerId: string, amount: number) {
  // Get the player from the game server
  const player = gameServer.wsManager.getPlayer(playerId);
  if (!player) {
    console.error(`Player ${playerId} not found`);
    return;
  }
  
  try {
    // Create a bet
    const betId = await gameServer.transport.server?.createBet(player, amount, { type: 'example-bet' });
    console.log(`Created bet ${betId} for player ${playerId}`);
    
    // Simulate a win
    if (betId && Math.random() > 0.5) {
      const winAmount = amount * 2;
      await gameServer.transport.server?.markBetWon(betId, winAmount, { result: 'win' });
      console.log(`Player ${playerId} won ${winAmount}`);
    } else if (betId) {
      await gameServer.transport.server?.markBetLost(betId, { result: 'loss' });
      console.log(`Player ${playerId} lost ${amount}`);
    }
  } catch (error) {
    console.error(`Error handling bet: ${error instanceof Error ? error.message : String(error)}`);
  }
} 