export interface Question {
  text: string;
  choices: [string, string, string, string];
  answer: 0 | 1 | 2 | 3;
}

export const QUESTIONS: readonly Question[] = [
  { text: 'How many cards are in a standard deck?', choices: ['48', '52', '54', '56'], answer: 1 },
  { text: 'Which suit is red?', choices: ['Spades', 'Clubs', 'Hearts', 'None'], answer: 2 },
  {
    text: 'What is the highest hand in poker?',
    choices: ['Four of a kind', 'Full house', 'Royal flush', 'Straight'],
    answer: 2,
  },
  { text: 'In blackjack, what is an ace worth?', choices: ['1', '11', '1 or 11', '10'], answer: 2 },
  { text: 'How many squares are on a chess board?', choices: ['32', '49', '64', '81'], answer: 2 },
  {
    text: 'Tic-tac-toe is played on a grid of...',
    choices: ['3 by 3', '4 by 4', '5 by 5', '8 by 8'],
    answer: 0,
  },
];
