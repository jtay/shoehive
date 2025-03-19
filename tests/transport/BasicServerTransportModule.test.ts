import { BasicServerTransportModule } from '../../src/transport/implementations/BasicServerTransportModule';
import { Player } from '../../src/core/Player';
import { EventBus } from '../../src/events/EventBus';
import * as WebSocket from 'ws';

// Mock dependencies
jest.mock('../../src/core/Player');
jest.mock('ws');

describe('BasicServerTransportModule', () => {
  let transportModule: BasicServerTransportModule;
  let mockPlayer: Player;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create transport module
    transportModule = new BasicServerTransportModule();
    
    // Create mock player
    const mockSocket = new WebSocket.WebSocket('ignored') as any;
    const eventBus = new EventBus();
    
    mockPlayer = {
      id: 'player-123',
      sendMessage: jest.fn(),
      getTable: jest.fn(),
      setTable: jest.fn(),
      setAttribute: jest.fn(),
      getAttribute: jest.fn(),
      hasAttribute: jest.fn(),
      disconnect: jest.fn(),
    } as unknown as Player;
  });
  
  test('should initialize with empty balances and bets', async () => {
    const balance = await transportModule.getPlayerBalance(mockPlayer);
    expect(balance).toBe(0);
    
    const bets = transportModule.getPlayerBets(mockPlayer.id);
    expect(bets).toEqual([]);
  });
  
  test('should set and get player balance', async () => {
    transportModule.setPlayerBalance(mockPlayer.id, 1000);
    
    const balance = await transportModule.getPlayerBalance(mockPlayer);
    expect(balance).toBe(1000);
  });
  
  test('should update player balance on bet creation', async () => {
    // Set initial balance
    transportModule.setPlayerBalance(mockPlayer.id, 1000);
    
    // Create bet
    const betId = await transportModule.createBet(mockPlayer, 500);
    
    // Check balance was reduced
    const newBalance = await transportModule.getPlayerBalance(mockPlayer);
    expect(newBalance).toBe(500);
    
    // Check bet was created
    const bets = transportModule.getPlayerBets(mockPlayer.id);
    expect(bets.length).toBe(1);
    expect(bets[0].id).toBe(betId);
    expect(bets[0].bet.amount).toBe(500);
    expect(bets[0].bet.status).toBe('pending');
  });
  
  test('should throw error when creating bet with insufficient balance', async () => {
    transportModule.setPlayerBalance(mockPlayer.id, 100);
    
    await expect(
      transportModule.createBet(mockPlayer, 500)
    ).rejects.toThrow('Insufficient balance');
    
    // Balance should remain unchanged
    const balance = await transportModule.getPlayerBalance(mockPlayer);
    expect(balance).toBe(100);
  });
  
  test('should mark bet as won and update balance', async () => {
    // Setup
    transportModule.setPlayerBalance(mockPlayer.id, 1000);
    const betId = await transportModule.createBet(mockPlayer, 500);
    
    // Mark bet as won
    await transportModule.markBetWon(betId, 1200);
    
    // Check balance was updated
    const newBalance = await transportModule.getPlayerBalance(mockPlayer);
    expect(newBalance).toBe(1700); // Initial 1000 - bet 500 + win 1200
    
    // Check bet status
    const bets = transportModule.getPlayerBets(mockPlayer.id);
    expect(bets[0].bet.status).toBe('won');
  });
  
  test('should mark bet as lost without changing balance', async () => {
    // Setup
    transportModule.setPlayerBalance(mockPlayer.id, 1000);
    const betId = await transportModule.createBet(mockPlayer, 500);
    
    // Mark bet as lost
    await transportModule.markBetLost(betId);
    
    // Check balance remains the same (after initial deduction)
    const newBalance = await transportModule.getPlayerBalance(mockPlayer);
    expect(newBalance).toBe(500);
    
    // Check bet status
    const bets = transportModule.getPlayerBets(mockPlayer.id);
    expect(bets[0].bet.status).toBe('lost');
  });
  
  test('should throw error when marking non-existent bet', async () => {
    await expect(
      transportModule.markBetWon('non-existent-bet', 100)
    ).rejects.toThrow('Bet not found');
    
    await expect(
      transportModule.markBetLost('non-existent-bet')
    ).rejects.toThrow('Bet not found');
  });
  
  test('should throw error when marking already settled bet', async () => {
    // Setup
    transportModule.setPlayerBalance(mockPlayer.id, 1000);
    const betId = await transportModule.createBet(mockPlayer, 500);
    
    // Mark bet as won
    await transportModule.markBetWon(betId, 1000);
    
    // Try to mark again
    await expect(
      transportModule.markBetWon(betId, 1000)
    ).rejects.toThrow('Bet already settled');
    
    await expect(
      transportModule.markBetLost(betId)
    ).rejects.toThrow('Bet already settled');
  });
  
  test('should store metadata with bets', async () => {
    // Set initial balance
    transportModule.setPlayerBalance(mockPlayer.id, 1000);
    
    // Create bet with metadata
    const metadata = { gameType: 'poker', hand: 'royal flush' };
    const betId = await transportModule.createBet(mockPlayer, 500, metadata);
    
    // Check metadata was stored
    const bets = transportModule.getPlayerBets(mockPlayer.id);
    expect(bets[0].bet.metadata).toEqual(metadata);
    
    // Update with more metadata on win
    const winMetadata = { winningHand: 'royal flush' };
    await transportModule.markBetWon(betId, 1000, winMetadata);
    
    // Check metadata was updated
    const updatedBets = transportModule.getPlayerBets(mockPlayer.id);
    expect(updatedBets[0].bet.metadata).toEqual({
      ...metadata,
      ...winMetadata
    });
  });
  
  test('should get only bets for specific player', async () => {
    // Create another mock player
    const anotherPlayer = { ...mockPlayer, id: 'player-456' } as Player;
    
    // Set balances for both players
    transportModule.setPlayerBalance(mockPlayer.id, 1000);
    transportModule.setPlayerBalance(anotherPlayer.id, 1000);
    
    // Create bets for both players
    await transportModule.createBet(mockPlayer, 300);
    await transportModule.createBet(mockPlayer, 200);
    await transportModule.createBet(anotherPlayer, 400);
    
    // Get bets for first player
    const playerBets = transportModule.getPlayerBets(mockPlayer.id);
    expect(playerBets.length).toBe(2);
    expect(playerBets[0].bet.amount).toBe(300);
    expect(playerBets[1].bet.amount).toBe(200);
    
    // Get bets for second player
    const anotherPlayerBets = transportModule.getPlayerBets(anotherPlayer.id);
    expect(anotherPlayerBets.length).toBe(1);
    expect(anotherPlayerBets[0].bet.amount).toBe(400);
  });
}); 