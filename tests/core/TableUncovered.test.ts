import { Table, TableState } from '../../src/core/Table';
import { EventBus } from '../../src/events/EventBus';
import { Player } from '../../src/core/Player';
import { Hand, Card, CardSuit, CardRank, Deck } from '../../src/core/card';
import * as WebSocket from 'ws';
import { TABLE_EVENTS } from '../../src/events/EventTypes';

// Mock WebSocket and Player class
jest.mock('ws');

describe('Table Uncovered Lines Tests', () => {
  let table: Table;
  let eventBus: EventBus;
  let player: Player;
  
  beforeEach(() => {
    jest.clearAllMocks();
    eventBus = new EventBus();
    
    // Create Table with 2 seats, max 1 seat per player
    table = new Table(eventBus, 2, 1, 'test-table-id');
    
    // Create a player
    const mockSocket = {
      readyState: 1, // WebSocket.OPEN
      send: jest.fn(),
      on: jest.fn(),
      close: jest.fn()
    } as unknown as WebSocket.WebSocket;
    
    player = new Player(mockSocket, eventBus, 'player-1');
  });
  
  // Test for dealCardToHand method (lines 152-159)
  describe('dealCardToHand method', () => {
    test('should deal a card directly to a hand object', () => {
      // Create a deck
      table.createDeck();
      
      // Create a hand
      const hand = new Hand('test-hand');
      
      // Spy on eventBus.emit
      const emitSpy = jest.spyOn(eventBus, 'emit');
      
      // Deal a card to the hand
      const result = table.dealCardToHand(hand);
      
      // Verify the card was dealt
      expect(result).toBe(true);
      expect(hand.getCards().length).toBe(1);
      
      // Verify events were emitted
      expect(emitSpy).toHaveBeenCalledWith(
        TABLE_EVENTS.CARD_DEALT,
        table,
        expect.any(Object), // Card
        'test-hand'
      );
    });
    
    test('should return false when dealing a card to hand with no deck', () => {
      // No deck created
      const hand = new Hand('test-hand');
      
      // Try to deal a card
      const result = table.dealCardToHand(hand);
      
      // Verify it fails
      expect(result).toBe(false);
      expect(hand.getCards().length).toBe(0);
    });
    
    test('should return false when no card can be drawn from empty deck', () => {
      // Create a deck
      table.createDeck();
      
      // Create a hand
      const hand = new Hand('test-hand');
      
      // Mock the drawCard method to return null (empty deck)
      const deck = table.getDeck() as Deck;
      jest.spyOn(deck, 'drawCard').mockReturnValue(null);
      
      // Try to deal a card
      const result = table.dealCardToHand(hand);
      
      // Verify it fails
      expect(result).toBe(false);
      expect(hand.getCards().length).toBe(0);
    });
  });
  
  // Test for removePlayer method (line 268)
  describe('removePlayer method', () => {
    test('should emit TABLE_EVENTS.EMPTY when last player is removed', () => {
      // Add a player
      table.addPlayer(player);
      
      // Spy on eventBus.emit
      const emitSpy = jest.spyOn(eventBus, 'emit');
      
      // Remove the player
      const result = table.removePlayer(player.id);
      
      // Verify player was removed
      expect(result).toBe(true);
      
      // Verify TABLE_EVENTS.EMPTY was emitted
      expect(emitSpy).toHaveBeenCalledWith(TABLE_EVENTS.EMPTY, table);
    });
    
    test('should remove player from all seats they occupy', () => {
      // Add a player
      table.addPlayer(player);
      
      // Sit the player at a seat
      table.sitPlayerAtSeat(player.id, 0);
      
      // Verify player is at the seat
      expect(table.getPlayerAtSeat(0)).toBe(player);
      
      // Remove the player
      table.removePlayer(player.id);
      
      // Verify player is no longer at the seat
      expect(table.getPlayerAtSeat(0)).toBeNull();
    });
  });
  
  // Test for getTableState and getTableMetadata (lines 520 and 541)
  describe('table state and metadata methods', () => {
    test('should include attributes in table state', () => {
      // Set some attributes
      table.setAttribute('gameType', 'poker');
      table.setAttribute('betLimit', 100);
      
      // Add a player and sit them at a seat
      table.addPlayer(player);
      table.sitPlayerAtSeat(player.id, 0);
      
      // Add a hand and deal a card to it
      table.createDeck();
      table.addHandToSeat(0, 'secondary');
      table.dealCardToSeat(0, true, 'secondary');
      
      // Get the table state
      const tableState = table.getTableState();
      
      // Verify table state has the attributes
      expect(tableState.attributes).toEqual({
        gameType: 'poker',
        betLimit: 100
      });
      
      // Verify player count is included
      expect(tableState.playerCount).toBe(1);
      
      // Verify seat info is included
      expect(tableState.seats[0].player.id).toBe('player-1');
      expect(tableState.seats[0].hands).toHaveProperty('main');
      expect(tableState.seats[0].hands).toHaveProperty('secondary');
    });
    
    test('should include player count and game information in metadata', () => {
      // Set some attributes
      table.setAttribute('gameId', 'poker-game');
      table.setAttribute('gameName', 'Texas Hold\'em');
      table.setAttribute('options', { ante: 10, blinds: [5, 10] });
      
      // Add a player
      table.addPlayer(player);
      
      // Get the table metadata
      const metadata = table.getTableMetadata();
      
      // Verify metadata includes player count
      expect(metadata.playerCount).toBe(1);
      
      // Verify metadata includes game information
      expect(metadata.gameId).toBe('poker-game');
      expect(metadata.gameName).toBe('Texas Hold\'em');
      expect(metadata.options).toEqual({ ante: 10, blinds: [5, 10] });
    });
  });
  
  // Test for removeAttribute method (lines 575-576)
  describe('removeAttribute method', () => {
    test('should remove an attribute and emit an event', () => {
      // Set an attribute
      table.setAttribute('gameType', 'poker');
      
      // Verify the attribute exists
      expect(table.getAttribute('gameType')).toBe('poker');
      
      // Spy on eventBus.emit
      const emitSpy = jest.spyOn(eventBus, 'emit');
      
      // Remove the attribute
      table.removeAttribute('gameType');
      
      // Verify the attribute was removed
      expect(table.hasAttribute('gameType')).toBe(false);
      expect(table.getAttribute('gameType')).toBeUndefined();
      
      // Verify an event was emitted
      expect(emitSpy).toHaveBeenCalledWith(
        TABLE_EVENTS.ATTRIBUTE_CHANGED,
        table,
        'gameType',
        undefined
      );
    });
    
    test('should handle removing non-existent attributes', () => {
      // Spy on eventBus.emit
      const emitSpy = jest.spyOn(eventBus, 'emit');
      
      // Remove a non-existent attribute
      table.removeAttribute('nonExistentAttribute');
      
      // Verify an event was still emitted
      expect(emitSpy).toHaveBeenCalledWith(
        TABLE_EVENTS.ATTRIBUTE_CHANGED,
        table,
        'nonExistentAttribute',
        undefined
      );
    });
  });
}); 