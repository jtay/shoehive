/** Shared by playwright.config.ts and the inspector tests. */
export const EXAMPLES = [
  { name: 'tic-tac-toe', port: 3101 },
  { name: 'quiz', port: 3102 },
  { name: 'blackjack', port: 3103 },
  { name: 'holdem', port: 3104 },
] as const;

/** A fixed devtools token for the example servers under test (never a real secret). */
export const DEVTOOLS_TOKEN = 'e2e-devtools-token-0123456789abcdef';
