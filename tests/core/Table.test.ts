import { Table, TableState } from '../../src/core/Table';
import { EventBus } from '../../src/events/EventBus';
import { Player } from '../../src/core/Player';
import * as WebSocket from 'ws';
import { TABLE_EVENTS } from '../../src/events/EventTypes';

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

describe('Table', () => {
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
  });
  
  test('should initialize with correct ID and state', () => {
    expect(table.id).toBe('test-table-id');
    expect(table.getState()).toBe(TableState.WAITING);
  });
  
  test('should generate a random ID if none provided', () => {
    const randomIdTable = new Table(eventBus, 2, 1);
    expect(randomIdTable.id).toBeTruthy();
    expect(typeof randomIdTable.id).toBe('string');
  });
  
  test('should add player successfully', () => {
    const spy = jest.spyOn(eventBus, 'emit');
    
    const result = table.addPlayer({ player: player1 });
    
    expect(result).toBe(true);
    expect(player1.setTable).toHaveBeenCalledWith({ table });
    expect(table.getPlayerCount()).toBe(1);
    expect(table.getPlayers()).toContain(player1);
    expect(spy).toHaveBeenCalledWith(TABLE_EVENTS.PLAYER_JOINED, { player: player1, table });
  });
  
  test('should not add player if already at another table', () => {
    player1.getTable = jest.fn().mockReturnValue({} as Table);
    
    const result = table.addPlayer({ player: player1 });
    
    expect(result).toBe(false);
    expect(table.getPlayerCount()).toBe(0);
  });
  
  test('should remove player successfully', () => {
    const spy = jest.spyOn(eventBus, 'emit');
    
    table.addPlayer({ player: player1 });
    const result = table.removePlayer({ playerId: player1.id });
    
    expect(result).toBe(true);
    expect(player1.setTable).toHaveBeenCalledWith({ table: null });
    expect(table.getPlayerCount()).toBe(0);
    expect(spy).toHaveBeenCalledWith(TABLE_EVENTS.PLAYER_LEFT, { player: player1, table });
    expect(spy).toHaveBeenCalledWith(TABLE_EVENTS.EMPTY, { table });
  });
  
  test('should return false when removing non-existent player', () => {
    const result = table.removePlayer({ playerId: 'non-existent' });
    expect(result).toBe(false);
  });
  
  test('should sit player at seat successfully', () => {
    const spy = jest.spyOn(eventBus, 'emit');
    
    table.addPlayer({ player: player1 });
    const result = table.sitPlayerAtSeat({ playerId: player1.id, seatIndex: 0 });
    
    expect(result).toBe(true);
    expect(table.getSeats()[0].getPlayer()).toBe(player1);
    expect(spy).toHaveBeenCalledWith(TABLE_EVENTS.PLAYER_SAT, { player: player1, table, seatIndex: 0 });
  });
  
  test('should not sit player if seat index is invalid', () => {
    table.addPlayer({ player: player1 });
    
    expect(table.sitPlayerAtSeat({ playerId: player1.id, seatIndex: -1 })).toBe(false);
    expect(table.sitPlayerAtSeat({ playerId: player1.id, seatIndex: 2 })).toBe(false);
  });
  
  test('should not sit player if seat is already taken', () => {
    table.addPlayer({ player: player1 });
    table.addPlayer({ player: player2 });
    
    table.sitPlayerAtSeat({ playerId: player1.id, seatIndex: 0 });
    const result = table.sitPlayerAtSeat({ playerId: player2.id, seatIndex: 0 });
    
    expect(result).toBe(false);
    expect(table.getSeats()[0].getPlayer()).toBe(player1);
  });
  
  test('should not sit player if not at table', () => {
    const result = table.sitPlayerAtSeat({ playerId: 'unknown-player', seatIndex: 0 });
    expect(result).toBe(false);
  });
  
  test('should not sit player if already seated at max seats', () => {
    table.addPlayer({ player: player1 });
    
    // Sit at seat 0, which should succeed
    table.sitPlayerAtSeat({ playerId: player1.id, seatIndex: 0 });
    
    // Sit at seat 1, which should fail due to max seats per player = 1
    const result = table.sitPlayerAtSeat({ playerId: player1.id, seatIndex: 1 });
    
    expect(result).toBe(false);
    expect(table.getSeats()[1].getPlayer()).toBeNull();
  });
  
  test('should remove player from seat successfully', () => {
    const spy = jest.spyOn(eventBus, 'emit');
    
    table.addPlayer({ player: player1 });
    table.sitPlayerAtSeat({ playerId: player1.id, seatIndex: 0 });
    
    const result = table.removePlayerFromSeat({ seatIndex: 0 });
    
    expect(result).toBe(true);
    expect(table.getSeats()[0].getPlayer()).toBeNull();
    expect(spy).toHaveBeenCalledWith(TABLE_EVENTS.PLAYER_STOOD, { player: player1, table, seatIndex: 0 });
  });
  
  test('should return false when removing from invalid seat index', () => {
    expect(table.removePlayerFromSeat({ seatIndex: -1 })).toBe(false);
    expect(table.removePlayerFromSeat({ seatIndex: 2 })).toBe(false);
  });
  
  test('should return false when removing from empty seat', () => {
    expect(table.removePlayerFromSeat({ seatIndex: 0 })).toBe(false);
  });
  
  test('should count player seats correctly', () => {
    table = new Table(eventBus, 3, 2); // Allow 2 seats per player
    
    table.addPlayer({ player: player1 });
    expect(table.getPlayerSeatCount({ playerId: player1.id })).toBe(0);
    
    table.sitPlayerAtSeat({ playerId: player1.id, seatIndex: 0 });
    expect(table.getPlayerSeatCount({ playerId: player1.id })).toBe(1);
    
    table.sitPlayerAtSeat({ playerId: player1.id, seatIndex: 1 });
    expect(table.getPlayerSeatCount({ playerId: player1.id })).toBe(2);
    
    table.removePlayerFromSeat({ seatIndex: 0 });
    expect(table.getPlayerSeatCount({ playerId: player1.id })).toBe(1);
  });
  
  test('should set and get state correctly', () => {
    const spy = jest.spyOn(eventBus, 'emit');
    
    expect(table.getState()).toBe(TableState.WAITING);
    
    table.setState({ state: TableState.ACTIVE });
    expect(table.getState()).toBe(TableState.ACTIVE);
    expect(spy).toHaveBeenCalledWith(TABLE_EVENTS.STATE_UPDATED, { table, state: TableState.ACTIVE });
    
    table.setState({ state: TableState.ENDED });
    expect(table.getState()).toBe(TableState.ENDED);
    expect(spy).toHaveBeenCalledWith(TABLE_EVENTS.STATE_UPDATED, { table, state: TableState.ENDED });
  });
  
  test('should broadcast message to all players', () => {
    table.addPlayer({ player: player1 });
    table.addPlayer({ player: player2 });
    
    const message = { type: 'test', data: 'broadcast' };
    table.broadcastMessage({ message: message });
    
    expect(player1.sendMessage).toHaveBeenCalledWith({ message: message });
    expect(player2.sendMessage).toHaveBeenCalledWith({ message: message });
  });
  
  test('should manage attributes correctly', () => {
    expect(table.hasAttribute({ key: 'gameType' })).toBe(false);
    
    table.setAttribute({ key: 'gameType', value: 'poker' });
    expect(table.hasAttribute({ key: 'gameType' })).toBe(true);
    expect(table.getAttribute({ key: 'gameType' })).toBe('poker');
    
    table.setAttribute({ key: 'gameType', value: 'blackjack' });
    expect(table.getAttribute({ key: 'gameType' })).toBe('blackjack');
    
    expect(table.getAttribute({ key: 'nonexistent' })).toBeUndefined();
  });
  
  test('should get player at seat', () => {
    table.addPlayer({ player: player1 });
    table.sitPlayerAtSeat({ playerId: player1.id, seatIndex: 0 });
    
    expect(table.getPlayerAtSeat({ seatIndex: 0 })).toBe(player1);
    expect(table.getPlayerAtSeat({ seatIndex: 1 })).toBeNull();
    expect(table.getPlayerAtSeat({ seatIndex: -1 })).toBeNull();
    expect(table.getPlayerAtSeat({ seatIndex: 2 })).toBeNull();
  });
}); 