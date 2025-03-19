import { Player } from "../../core/Player";
import { ServerTransportModule } from "../ServerTransportModule";

/**
 * A basic in-memory implementation of the ServerTransportModule.
 * This is provided as an example and for testing - in a real application,
 * you would likely connect to an external service or database.
 */
export class BasicServerTransportModule implements ServerTransportModule {
  // In-memory storage for player balances and bets
  private playerBalances: Map<string, number> = new Map();
  private bets: Map<string, {
    playerId: string;
    amount: number;
    status: 'pending' | 'won' | 'lost';
    metadata?: Record<string, any>;
  }> = new Map();

  /**
   * Get the current balance for a player
   * @param player The player to check balance for
   * @returns A promise that resolves to the player's balance
   */
  public async getPlayerBalance(player: Player): Promise<number> {
    // Return the player's balance if it exists, otherwise return 0
    return this.playerBalances.get(player.id) || 0;
  }

  /**
   * Set a player's balance to a specific amount
   * @param playerId The ID of the player
   * @param amount The amount to set the balance to
   */
  public setPlayerBalance(playerId: string, amount: number): void {
    this.playerBalances.set(playerId, amount);
  }

  /**
   * Create a bet for a player
   * @param player The player making the bet
   * @param amount The amount of the bet
   * @param metadata Any additional information about the bet
   * @returns A promise that resolves to a bet ID if successful
   */
  public async createBet(player: Player, amount: number, metadata?: Record<string, any>): Promise<string> {
    // Check if player has sufficient balance
    const balance = await this.getPlayerBalance(player);
    if (balance < amount) {
      throw new Error("Insufficient balance");
    }

    // Generate a unique bet ID
    const betId = `bet-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    // Deduct amount from player's balance
    this.playerBalances.set(player.id, balance - amount);

    // Store the bet
    this.bets.set(betId, {
      playerId: player.id,
      amount,
      status: 'pending',
      metadata
    });

    return betId;
  }

  /**
   * Mark a bet as won and award the player
   * @param betId The ID of the bet to mark as won
   * @param winAmount The amount the player won
   * @param metadata Any additional information about the win
   * @returns A promise that resolves to true if successful
   */
  public async markBetWon(betId: string, winAmount: number, metadata?: Record<string, any>): Promise<boolean> {
    // Check if bet exists
    const bet = this.bets.get(betId);
    if (!bet) {
      throw new Error("Bet not found");
    }

    // Check if bet is already settled
    if (bet.status !== 'pending') {
      throw new Error("Bet already settled");
    }

    // Update bet status
    bet.status = 'won';
    if (metadata) {
      bet.metadata = { ...bet.metadata, ...metadata };
    }
    this.bets.set(betId, bet);

    // Update player balance
    const currentBalance = this.playerBalances.get(bet.playerId) || 0;
    this.playerBalances.set(bet.playerId, currentBalance + winAmount);

    return true;
  }

  /**
   * Mark a bet as lost
   * @param betId The ID of the bet to mark as lost
   * @param metadata Any additional information about the loss
   * @returns A promise that resolves to true if successful
   */
  public async markBetLost(betId: string, metadata?: Record<string, any>): Promise<boolean> {
    // Check if bet exists
    const bet = this.bets.get(betId);
    if (!bet) {
      throw new Error("Bet not found");
    }

    // Check if bet is already settled
    if (bet.status !== 'pending') {
      throw new Error("Bet already settled");
    }

    // Update bet status
    bet.status = 'lost';
    if (metadata) {
      bet.metadata = { ...bet.metadata, ...metadata };
    }
    this.bets.set(betId, bet);

    return true;
  }

  /**
   * Get all bets for a player
   * @param playerId The ID of the player
   * @returns An array of bets for the player
   */
  public getPlayerBets(playerId: string): Array<{ id: string, bet: any }> {
    const playerBets: Array<{ id: string, bet: any }> = [];
    
    this.bets.forEach((bet, id) => {
      if (bet.playerId === playerId) {
        playerBets.push({ id, bet });
      }
    });
    
    return playerBets;
  }
} 