import { Seat } from '../../src/core/Seat';
import { Player } from '../../src/core/Player';
import { Hand, CardSuit, CardRank } from '../../src/core/card';

describe('Seat', () => {
  let seat: Seat;
  
  beforeEach(() => {
    seat = new Seat();
  });
  
  test('should initialize with a main hand', () => {
    const hand = seat.getHand({ handId: 'main' });
    expect(hand).not.toBeNull();
    expect(hand?.getId()).toBe('main');
  });
  
  test('should set and get player', () => {
    expect(seat.getPlayer()).toBeNull();
    
    const mockPlayer = { id: 'player-id' } as Player;
    seat.setPlayer({ player: mockPlayer });
    expect(seat.getPlayer()).toBe(mockPlayer);
    
    seat.setPlayer({ player: null });
    expect(seat.getPlayer()).toBeNull();
  });
  
  test('should add a hand', () => {
    expect(seat.addHand({ handId: 'secondary' })).toBe(true);
    const hand = seat.getHand({ handId: 'secondary' });
    expect(hand).not.toBeNull();
    expect(hand?.getId()).toBe('secondary');
  });
  
  test('should not add a hand if it already exists', () => {
    seat.addHand({ handId: 'secondary' });
    expect(seat.addHand({ handId: 'secondary' })).toBe(false);
  });
  
  test('should remove a hand', () => {
    seat.addHand({ handId: 'secondary' });
    expect(seat.removeHand({ handId: 'secondary' })).toBe(true);
    expect(seat.getHand({ handId: 'secondary' })).toBeNull();
  });
  
  test('should not remove the main hand', () => {
    expect(seat.removeHand({ handId: 'main' })).toBe(false);
    expect(seat.getHand({ handId: 'main' })).not.toBeNull();
  });
  
  test('should not remove a non-existent hand', () => {
    expect(seat.removeHand({ handId: 'non-existent' })).toBe(false);
  });
  
  test('should get a hand', () => {
    const hand = seat.getHand({});
    expect(hand).not.toBeNull();
    expect(hand?.getId()).toBe('main');
  });
  
  test('should return null for non-existent hand', () => {
    expect(seat.getHand({ handId: 'non-existent' })).toBeNull();
  });
  
  test('should get all hands', () => {
    seat.addHand({ handId: 'secondary' });
    seat.addHand({ handId: 'tertiary' });
    
    const hands = seat.getAllHands();
    expect(hands.size).toBe(3);
    expect(hands.has('main')).toBe(true);
    expect(hands.has('secondary')).toBe(true);
    expect(hands.has('tertiary')).toBe(true);
  });
  
  test('should clear a hand', () => {
    const mainHand = seat.getHand({ handId: 'main' });
    const mockCard = {
      suit: CardSuit.HEARTS,
      rank: CardRank.TEN,
      isVisible: true
    };
    mainHand?.addCard({ card: mockCard });
    
    expect(seat.clearHand({ handId: 'main' })).toBe(true);
    expect(mainHand?.getCards().length).toBe(0);
  });
  
  test('should not clear a non-existent hand', () => {
    expect(seat.clearHand({ handId: 'non-existent' })).toBe(false);
  });
  
  test('should clear all hands', () => {
    seat.addHand({ handId: 'secondary' });
    
    const mainHand = seat.getHand({ handId: 'main' });
    const secondaryHand = seat.getHand({ handId: 'secondary' });
    
    const mockCard1 = {
      suit: CardSuit.HEARTS,
      rank: CardRank.TEN,
      isVisible: true
    };
    
    const mockCard2 = {
      suit: CardSuit.SPADES,
      rank: CardRank.ACE,
      isVisible: true
    };
    
    mainHand?.addCard({ card: mockCard1 });
    secondaryHand?.addCard({ card: mockCard2 });
    
    seat.clearAllHands();
    
    expect(mainHand?.getCards().length).toBe(0);
    expect(secondaryHand?.getCards().length).toBe(0);
  });
  
  test('should set and get attributes', () => {
    seat.setAttribute({ key: 'color', value: 'red' });
    expect(seat.getAttribute({ key: 'color' })).toBe('red');
  });
  
  test('should check if an attribute exists', () => {
    expect(seat.hasAttribute({ key: 'color' })).toBe(false);
    seat.setAttribute({ key: 'color', value: 'red' });
    expect(seat.hasAttribute({ key: 'color' })).toBe(true);
  });
  
  test('should get all attributes', () => {
    seat.setAttribute({ key: 'color', value: 'red' });
    seat.setAttribute({ key: 'position', value: 1 });
    
    const attributes = seat.getAttributes();
    expect(attributes).toEqual({
      color: 'red',
      position: 1
    });
  });
  
  test('should set multiple attributes at once', () => {
    seat.setAttributes({ attributes: {
                color: 'red',
                position: 1,
                active: true
              } });
    
    expect(seat.getAttribute({ key: 'color' })).toBe('red');
    expect(seat.getAttribute({ key: 'position' })).toBe(1);
    expect(seat.getAttribute({ key: 'active' })).toBe(true);
  });
  
  test('should remove an attribute', () => {
    seat.setAttribute({ key: 'color', value: 'red' });
    expect(seat.hasAttribute({ key: 'color' })).toBe(true);
    
    seat.removeAttribute({ key: 'color' });
    expect(seat.hasAttribute({ key: 'color' })).toBe(false);
  });
  
  test('should check if a player can modify the seat', () => {
    const mockPlayer = { id: 'player-id' } as Player;
    seat.setPlayer({ player: mockPlayer });
    
    expect(seat.canPlayerModify({ playerId: 'player-id' })).toBe(true);
    expect(seat.canPlayerModify({ playerId: 'different-player' })).toBe(false);
  });
  
  test('should return false for canPlayerModify if no player is set', () => {
    expect(seat.canPlayerModify({ playerId: 'player-id' })).toBe(false);
  });
}); 