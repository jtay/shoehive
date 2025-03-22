import { Table } from '../../src/core/Table';
import { EventBus } from '../../src/events/EventBus';
import { Player } from '../../src/core/Player';
import { TABLE_EVENTS } from '../../src/events/EventTypes';
import * as WebSocket from 'ws';

jest.mock('ws');

describe('Table Player and Seat Management', () => {
  let table: Table;
  let eventBus: EventBus;
  let players: Player[];
  const totalSeats = 6;
  const maxSeatsPerPlayer = 1;

  beforeEach(() => {
    // Create mocks
    eventBus = new EventBus();
    jest.spyOn(eventBus, 'emit');
    
    // Create a table
    table = new Table(eventBus, totalSeats, maxSeatsPerPlayer, 'test-table-id');
    
    // Create mock players
    players = Array(3).fill(null).map((_, index) => {
      const mockSocket = {
        readyState: WebSocket.WebSocket.OPEN,
        send: jest.fn(),
        on: jest.fn(),
        close: jest.fn()
      } as unknown as WebSocket.WebSocket;
      
      return new Player(mockSocket, eventBus, `player-${index}`);
    });
  });

  describe('Player and Seat Management', () => {
    test('should add and remove players', () => {
      // Add players
      expect(table.addPlayer(players[0])).toBe(true);
      expect(table.addPlayer(players[1])).toBe(true);
      
      // Check player count
      expect(table.getPlayerCount()).toBe(2);
      
      // Get all players
      const tablePlayers = table.getPlayers();
      expect(tablePlayers).toHaveLength(2);
      expect(tablePlayers).toEqual(expect.arrayContaining([players[0], players[1]]));
      
      // Remove a player
      expect(table.removePlayer(players[0].id)).toBe(true);
      expect(table.getPlayerCount()).toBe(1);
      
      // Try to remove a non-existent player
      expect(table.removePlayer('non-existent-id')).toBe(false);
    });
    
    test('should seat players at specific seat indices', () => {
      // Add players
      table.addPlayer(players[0]);
      table.addPlayer(players[1]);
      
      // Sit players at seats
      expect(table.sitPlayerAtSeat(players[0].id, 0)).toBe(true);
      expect(table.sitPlayerAtSeat(players[1].id, 1)).toBe(true);
      
      // Check seats
      expect(table.getPlayerAtSeat(0)).toBe(players[0]);
      expect(table.getPlayerAtSeat(1)).toBe(players[1]);
      
      // Try to sit a player at an invalid seat
      expect(table.sitPlayerAtSeat(players[0].id, totalSeats + 1)).toBe(false);
      
      // Try to sit a non-existent player
      expect(table.sitPlayerAtSeat('non-existent-id', 2)).toBe(false);
    });
    
    test('should not allow player to occupy more than maxSeatsPerPlayer seats', () => {
      // Add player
      table.addPlayer(players[0]);
      
      // Sit player at first seat
      expect(table.sitPlayerAtSeat(players[0].id, 0)).toBe(true);
      
      // Try to sit the same player at another seat (should fail due to maxSeatsPerPlayer)
      expect(table.sitPlayerAtSeat(players[0].id, 1)).toBe(false);
      
      // Check seat count
      expect(table.getPlayerSeatCount(players[0].id)).toBe(1);
    });
    
    test('should remove player from seat', () => {
      // Add and seat player
      table.addPlayer(players[0]);
      table.sitPlayerAtSeat(players[0].id, 0);
      
      // Remove player from seat
      expect(table.removePlayerFromSeat(0)).toBe(true);
      
      // Check that seat is empty
      expect(table.getPlayerAtSeat(0)).toBeNull();
      
      // Try to remove player from an invalid seat
      expect(table.removePlayerFromSeat(totalSeats + 1)).toBe(false);
    });
    
    test('should get seat and all seats', () => {
      // Get a seat by index
      const seat = table.getSeat(0);
      expect(seat).not.toBeNull();
      
      // Try to get an invalid seat
      expect(table.getSeat(totalSeats + 1)).toBeNull();
      
      // Get all seats
      const seats = table.getSeats();
      expect(seats).toHaveLength(totalSeats);
    });
  });
  
  describe('Broadcasting', () => {
    test('should broadcast message to all players', () => {
      // Add players and sit them
      table.addPlayer(players[0]);
      table.addPlayer(players[1]);
      table.sitPlayerAtSeat(players[0].id, 0);
      table.sitPlayerAtSeat(players[1].id, 1);
      
      // Create a test message
      const message = { type: 'test-message', data: { foo: 'bar' } };
      
      // Broadcast the message
      table.broadcastMessage(message);
      
      // Check that both players received the message
      for (const player of players.slice(0, 2)) {
        const mockSocket = player['socket'] as jest.Mocked<WebSocket.WebSocket>;
        expect(mockSocket.send).toHaveBeenCalledWith(JSON.stringify(message));
      }
    });
    
    test('should broadcast table state', () => {
      // Add players and sit them
      table.addPlayer(players[0]);
      table.addPlayer(players[1]);
      table.sitPlayerAtSeat(players[0].id, 0);
      table.sitPlayerAtSeat(players[1].id, 1);
      
      // Set some attributes
      table.setAttribute('gameType', 'poker');
      
      // Broadcast table state
      table.broadcastTableState();
      
      // Check that both players received a message
      for (const player of players.slice(0, 2)) {
        const mockSocket = player['socket'] as jest.Mocked<WebSocket.WebSocket>;
        expect(mockSocket.send).toHaveBeenCalled();
        
        // Get the sent message and parse it
        const sentMessageCall = mockSocket.send.mock.calls[0][0];
        const sentMessage = JSON.parse(sentMessageCall as string);
        
        // Verify the message contains the expected table state info
        expect(sentMessage.type).toBe('table:state');
        expect(sentMessage.data).toHaveProperty('id', 'test-table-id');
        expect(sentMessage.data.attributes).toHaveProperty('gameType', 'poker');
        expect(sentMessage.data.seats).toHaveLength(totalSeats);
        expect(sentMessage.data.playerCount).toBe(2);
      }
    });
    
    test('should get table state and metadata', () => {
      // Add players and sit them
      table.addPlayer(players[0]);
      table.sitPlayerAtSeat(players[0].id, 0);
      
      // Set some attributes
      table.setAttribute('gameType', 'poker');
      table.setAttribute('betLimit', 100);
      
      // Get table state
      const tableState = table.getTableState();
      
      // Verify table state
      expect(tableState).toHaveProperty('id', 'test-table-id');
      expect(tableState.attributes).toHaveProperty('gameType', 'poker');
      expect(tableState.attributes).toHaveProperty('betLimit', 100);
      expect(tableState).toHaveProperty('seats');
      expect(tableState.seats).toHaveLength(totalSeats);
      
      // The first seat should have the player's data
      expect(tableState.seats[0]).toHaveProperty('player');
      expect(tableState.seats[0].player).toHaveProperty('id', players[0].id);
      
      // Get table metadata
      const metadata = table.getTableMetadata();
      
      // Verify metadata - metadata has a flat structure
      expect(metadata).toHaveProperty('id', 'test-table-id');
      expect(metadata).toHaveProperty('state', 'waiting');
      expect(metadata).toHaveProperty('playerCount', 1);
      expect(metadata.seats).toEqual([
        'player-0', null, null, null, null, null
      ]);
    });
  });
}); 