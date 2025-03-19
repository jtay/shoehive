import { Player } from "../core/Player";

/**
 * Interface for handling server-side transport operations like player balances and bets.
 * This module enables communication with external systems for financial transactions.
 */
export interface ServerTransportModule {
  /**
   * Get the current balance for a player
   * @param player The player to check balance for
   * @returns A promise that resolves to the player's balance
   */
  getPlayerBalance(player: Player): Promise<number>;
  
  /**
   * Create a bet for a player
   * @param player The player making the bet
   * @param amount The amount of the bet
   * @param metadata Any additional information about the bet
   * @returns A promise that resolves to a bet ID if successful
   */
  createBet(player: Player, amount: number, metadata?: Record<string, any>): Promise<string>;
  
  /**
   * Mark a bet as won and award the player
   * @param betId The ID of the bet to mark as won
   * @param winAmount The amount the player won
   * @param metadata Any additional information about the win
   * @returns A promise that resolves to true if successful
   */
  markBetWon(betId: string, winAmount: number, metadata?: Record<string, any>): Promise<boolean>;
  
  /**
   * Mark a bet as lost
   * @param betId The ID of the bet to mark as lost
   * @param metadata Any additional information about the loss
   * @returns A promise that resolves to true if successful
   */
  markBetLost(betId: string, metadata?: Record<string, any>): Promise<boolean>;
} 