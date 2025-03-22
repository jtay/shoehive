import { Seat } from '../../src/core/Seat';
import { Player } from '../../src/core/Player';
import { Hand, CardSuit, CardRank } from '../../src/core/card';

describe('Seat', () => {
  let seat: Seat;
  
  beforeEach(() => {
    seat = new Seat();
  });
  
  test('should initialize with a main hand', () => {
    const hand = seat.getHand('main');
    expect(hand).not.toBeNull();
    expect(hand?.getId()).toBe('main');
  });
  
  test('should set and get player', () => {
    expect(seat.getPlayer()).toBeNull();
    
    const mockPlayer = { id: 'player-id' } as Player;
    seat.setPlayer(mockPlayer);
    expect(seat.getPlayer()).toBe(mockPlayer);
    
    seat.setPlayer(null);
    expect(seat.getPlayer()).toBeNull();
  });
  
  test('should add a hand', () => {
    expect(seat.addHand('secondary')).toBe(true);
    const hand = seat.getHand('secondary');
    expect(hand).not.toBeNull();
    expect(hand?.getId()).toBe('secondary');
  });
  
  test('should not add a hand if it already exists', () => {
    seat.addHand('secondary');
    expect(seat.addHand('secondary')).toBe(false);
  });
  
  test('should remove a hand', () => {
    seat.addHand('secondary');
    expect(seat.removeHand('secondary')).toBe(true);
    expect(seat.getHand('secondary')).toBeNull();
  });
  
  test('should not remove the main hand', () => {
    expect(seat.removeHand('main')).toBe(false);
    expect(seat.getHand('main')).not.toBeNull();
  });
  
  test('should not remove a non-existent hand', () => {
    expect(seat.removeHand('non-existent')).toBe(false);
  });
  
  test('should get a hand', () => {
    const hand = seat.getHand();
    expect(hand).not.toBeNull();
    expect(hand?.getId()).toBe('main');
  });
  
  test('should return null for non-existent hand', () => {
    expect(seat.getHand('non-existent')).toBeNull();
  });
  
  test('should get all hands', () => {
    seat.addHand('secondary');
    seat.addHand('tertiary');
    
    const hands = seat.getAllHands();
    expect(hands.size).toBe(3);
    expect(hands.has('main')).toBe(true);
    expect(hands.has('secondary')).toBe(true);
    expect(hands.has('tertiary')).toBe(true);
  });
  
  test('should clear a hand', () => {
    const mainHand = seat.getHand('main');
    const mockCard = {
      suit: CardSuit.HEARTS,
      rank: CardRank.TEN,
      isVisible: true
    };
    mainHand?.addCard(mockCard);
    
    expect(seat.clearHand('main')).toBe(true);
    expect(mainHand?.getCards().length).toBe(0);
  });
  
  test('should not clear a non-existent hand', () => {
    expect(seat.clearHand('non-existent')).toBe(false);
  });
  
  test('should clear all hands', () => {
    seat.addHand('secondary');
    
    const mainHand = seat.getHand('main');
    const secondaryHand = seat.getHand('secondary');
    
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
    
    mainHand?.addCard(mockCard1);
    secondaryHand?.addCard(mockCard2);
    
    seat.clearAllHands();
    
    expect(mainHand?.getCards().length).toBe(0);
    expect(secondaryHand?.getCards().length).toBe(0);
  });
  
  test('should set and get attributes', () => {
    seat.setAttribute('color', 'red');
    expect(seat.getAttribute('color')).toBe('red');
  });
  
  test('should check if an attribute exists', () => {
    expect(seat.hasAttribute('color')).toBe(false);
    seat.setAttribute('color', 'red');
    expect(seat.hasAttribute('color')).toBe(true);
  });
  
  test('should get all attributes', () => {
    seat.setAttribute('color', 'red');
    seat.setAttribute('position', 1);
    
    const attributes = seat.getAttributes();
    expect(attributes).toEqual({
      color: 'red',
      position: 1
    });
  });
  
  test('should set multiple attributes at once', () => {
    seat.setAttributes({
      color: 'red',
      position: 1,
      active: true
    });
    
    expect(seat.getAttribute('color')).toBe('red');
    expect(seat.getAttribute('position')).toBe(1);
    expect(seat.getAttribute('active')).toBe(true);
  });
  
  test('should remove an attribute', () => {
    seat.setAttribute('color', 'red');
    expect(seat.hasAttribute('color')).toBe(true);
    
    seat.removeAttribute('color');
    expect(seat.hasAttribute('color')).toBe(false);
  });
  
  test('should check if a player can modify the seat', () => {
    const mockPlayer = { id: 'player-id' } as Player;
    seat.setPlayer(mockPlayer);
    
    expect(seat.canPlayerModify('player-id')).toBe(true);
    expect(seat.canPlayerModify('different-player')).toBe(false);
  });
  
  test('should return false for canPlayerModify if no player is set', () => {
    expect(seat.canPlayerModify('player-id')).toBe(false);
  });
}); 