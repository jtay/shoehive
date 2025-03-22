export enum CardSuit {
  HEARTS = "H",
  DIAMONDS = "D",
  CLUBS = "C",
  SPADES = "S"
}

export enum CardRank {
  ACE = "A",
  TWO = "2",
  THREE = "3",
  FOUR = "4",
  FIVE = "5",
  SIX = "6",
  SEVEN = "7",
  EIGHT = "8",
  NINE = "9",
  TEN = "T",
  JACK = "J",
  QUEEN = "Q",
  KING = "K"
}

export interface Card {
  suit: CardSuit;
  rank: CardRank;
  value?: number;
  isVisible: boolean;
} 