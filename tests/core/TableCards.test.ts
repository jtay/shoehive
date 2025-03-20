import { Table, TableState } from '../../src/core/Table';
import { EventBus } from '../../src/events/EventBus';
import { Player } from '../../src/core/Player';
import { Card, CardRank, CardSuit } from '../../src/core/Card';
import * as WebSocket from 'ws';

// Mock WebSocket and Player class
jest.mock('ws', () => {
  const mockWebSocket = {
    on: jest.fn(),
    send: jest.fn(),
    close: jest.fn(),
    readyState: 1, // WebSocket.OPEN
    WebSocket: {
      OPEN: 1
    }
  };
  
  return {
    WebSocket: jest.fn(() => mockWebSocket)
  };
});

jest.mock('../../src/core/Player');

describe('Table Card Functionality', () => {
  let table: Table;
  let eventBus: EventBus;
  let player1: any; // Using any to avoid TypeScript errors with mocks
  let player2: any;
  
  beforeEach(() => {
    jest.clearAllMocks();
    eventBus = new EventBus();
    
    // Create Table with 2 seats, max 1 seat per player
    table = new Table(eventBus, 2, 1, 'test-table-id');
    
    // Create mock players with correct mocking
    const mockSocket = new WebSocket.WebSocket('ignored');
    
    // Reset the mock implementation of Player
    (Player as jest.MockedClass<typeof Player>).mockImplementation(() => {
      return {
        id: '',
        getTable: jest.fn().mockReturnValue(null),
        setTable: jest.fn(),
        sendMessage: jest.fn(),
        setAttribute: jest.fn(),
        getAttribute: jest.fn(),
        hasAttribute: jest.fn(),
        disconnect: jest.fn(),
      } as unknown as Player;
    });
    
    player1 = new Player(mockSocket, eventBus);
    // Override the id for testing purposes
    Object.defineProperty(player1, 'id', { value: 'player1', writable: true });
    
    player2 = new Player(mockSocket, eventBus);
    Object.defineProperty(player2, 'id', { value: 'player2', writable: true });
    
    // Add players to table
    table.addPlayer(player1);
    table.addPlayer(player2);
    
    // Sit players at seats
    table.sitPlayerAtSeat(player1.id, 0);
    table.sitPlayerAtSeat(player2.id, 1);
  });
  
  describe('Deck Management', () => {
    test('should create a deck', () => {
      const spy = jest.spyOn(eventBus, 'emit');
      
      table.createDeck();
      
      expect(table.getDeck()).not.toBeNull();
      expect(spy).toHaveBeenCalledWith('table:deck:created', table, 1);
    });
    
    test('should create a deck with multiple decks', () => {
      table.createDeck(6);
      
      const deck = table.getDeck();
      expect(deck).not.toBeNull();
      expect(deck!.getRemainingCards()).toBe(312); // 6 decks * 52 cards
    });
    
    test('should shuffle the deck', () => {
      const spy = jest.spyOn(eventBus, 'emit');
      
      // No deck yet
      expect(table.shuffleDeck()).toBe(false);
      
      table.createDeck();
      expect(table.shuffleDeck()).toBe(true);
      expect(spy).toHaveBeenCalledWith('table:deck:shuffled', table);
    });
    
    test('should draw a card from the deck', () => {
      // No deck yet
      expect(table.drawCard()).toBeNull();
      
      table.createDeck();
      const spy = jest.spyOn(eventBus, 'emit');
      
      const card = table.drawCard();
      
      expect(card).not.toBeNull();
      expect(card!.isVisible).toBe(true);
      expect(spy).toHaveBeenCalledWith('table:deck:card:drawn', table, card);
      
      const hiddenCard = table.drawCard(false);
      expect(hiddenCard!.isVisible).toBe(false);
    });
  });
  
  describe('Seat Hands Management', () => {
    test('should have main hand for each seat by default', () => {
      const hand = table.getHandAtSeat(0);
      expect(hand).not.toBeNull();
      expect(hand!.getId()).toBe('main');
      expect(hand!.getCards().length).toBe(0);
    });
    
    test('should add a new hand to a seat', () => {
      const spy = jest.spyOn(eventBus, 'emit');
      
      expect(table.addHandToSeat(0, 'split')).toBe(true);
      
      const hand = table.getHandAtSeat(0, 'split');
      expect(hand).not.toBeNull();
      expect(hand!.getId()).toBe('split');
      expect(spy).toHaveBeenCalledWith('table:seat:hand:added', table, 0, 'split');
    });
    
    test('should not add duplicate hand id', () => {
      table.addHandToSeat(0, 'split');
      expect(table.addHandToSeat(0, 'split')).toBe(false);
    });
    
    test('should not add hand to invalid seat', () => {
      expect(table.addHandToSeat(-1, 'split')).toBe(false);
      expect(table.addHandToSeat(5, 'split')).toBe(false);
    });
    
    test('should remove a hand from a seat', () => {
      const spy = jest.spyOn(eventBus, 'emit');
      
      table.addHandToSeat(0, 'split');
      expect(table.removeHandFromSeat(0, 'split')).toBe(true);
      
      expect(table.getHandAtSeat(0, 'split')).toBeNull();
      expect(spy).toHaveBeenCalledWith('table:seat:hand:removed', table, 0, 'split');
    });
    
    test('should not remove main hand', () => {
      expect(table.removeHandFromSeat(0, 'main')).toBe(false);
      expect(table.getHandAtSeat(0, 'main')).not.toBeNull();
    });
    
    test('should not remove hand from invalid seat', () => {
      expect(table.removeHandFromSeat(-1, 'split')).toBe(false);
      expect(table.removeHandFromSeat(5, 'split')).toBe(false);
    });
    
    test('should get all hands at a seat', () => {
      table.addHandToSeat(0, 'split');
      table.addHandToSeat(0, 'double');
      
      const hands = table.getAllHandsAtSeat(0);
      
      expect(hands).not.toBeNull();
      expect(hands!.size).toBe(3);
      expect(hands!.has('main')).toBe(true);
      expect(hands!.has('split')).toBe(true);
      expect(hands!.has('double')).toBe(true);
    });
    
    test('should clear a hand at a seat', () => {
      table.createDeck();
      
      // Deal some cards
      table.dealCardToSeat(0);
      table.dealCardToSeat(0);
      
      const handBefore = table.getHandAtSeat(0);
      expect(handBefore!.getCards().length).toBe(2);
      
      const spy = jest.spyOn(eventBus, 'emit');
      
      expect(table.clearHandAtSeat(0)).toBe(true);
      
      const handAfter = table.getHandAtSeat(0);
      expect(handAfter!.getCards().length).toBe(0);
      expect(spy).toHaveBeenCalledWith('table:seat:hand:cleared', table, 0, 'main');
    });
    
    test('should not clear hand on invalid seat', () => {
      expect(table.clearHandAtSeat(-1)).toBe(false);
      expect(table.clearHandAtSeat(5)).toBe(false);
    });
    
    test('should not clear nonexistent hand', () => {
      expect(table.clearHandAtSeat(0, 'nonexistent')).toBe(false);
    });
    
    test('should clear all hands', () => {
      table.createDeck();
      
      // Add multiple hands
      table.addHandToSeat(0, 'split');
      table.addHandToSeat(1, 'split');
      
      // Deal cards to different hands
      table.dealCardToSeat(0);
      table.dealCardToSeat(0, true, 'split');
      table.dealCardToSeat(1);
      
      const spy = jest.spyOn(eventBus, 'emit');
      
      table.clearAllHands();
      
      expect(table.getHandAtSeat(0)!.getCards().length).toBe(0);
      expect(table.getHandAtSeat(0, 'split')!.getCards().length).toBe(0);
      expect(table.getHandAtSeat(1)!.getCards().length).toBe(0);
      expect(spy).toHaveBeenCalledWith('table:seats:hands:cleared', table);
    });
  });
  
  describe('Card Dealing', () => {
    test('should deal a card to a seat', () => {
      table.createDeck();
      const spy = jest.spyOn(eventBus, 'emit');
      
      const result = table.dealCardToSeat(0);
      
      expect(result).toBe(true);
      const hand = table.getHandAtSeat(0);
      expect(hand!.getCards().length).toBe(1);
      expect(hand!.getCards()[0].isVisible).toBe(true);
      
      // Check event emission with correct parameters
      expect(spy).toHaveBeenCalledWith(
        'table:card:dealt', 
        table, 
        0, 
        hand!.getCards()[0], 
        'main'
      );
    });
    
    test('should deal a hidden card to a seat', () => {
      table.createDeck();
      
      table.dealCardToSeat(0, false);
      
      const hand = table.getHandAtSeat(0);
      expect(hand!.getCards().length).toBe(1);
      expect(hand!.getCards()[0].isVisible).toBe(false);
      expect(hand!.getVisibleCards().length).toBe(0);
      expect(hand!.getHiddenCards().length).toBe(1);
    });
    
    test('should deal card to specific hand', () => {
      table.createDeck();
      table.addHandToSeat(0, 'split');
      
      table.dealCardToSeat(0, true, 'split');
      
      expect(table.getHandAtSeat(0)!.getCards().length).toBe(0);
      expect(table.getHandAtSeat(0, 'split')!.getCards().length).toBe(1);
    });
    
    test('should create hand if it does not exist', () => {
      table.createDeck();
      
      expect(table.getHandAtSeat(0, 'newHand')).toBeNull();
      
      table.dealCardToSeat(0, true, 'newHand');
      
      expect(table.getHandAtSeat(0, 'newHand')).not.toBeNull();
      expect(table.getHandAtSeat(0, 'newHand')!.getCards().length).toBe(1);
    });
    
    test('should not deal card if no deck exists', () => {
      expect(table.dealCardToSeat(0)).toBe(false);
    });
    
    test('should not deal card to invalid seat', () => {
      table.createDeck();
      
      expect(table.dealCardToSeat(-1)).toBe(false);
      expect(table.dealCardToSeat(5)).toBe(false);
    });
    
    test('should not deal card if deck is empty', () => {
      table.createDeck(1);
      
      // Draw all 52 cards
      for (let i = 0; i < 52; i++) {
        table.drawCard();
      }
      
      expect(table.dealCardToSeat(0)).toBe(false);
    });
  });
}); 