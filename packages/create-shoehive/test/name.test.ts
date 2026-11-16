import { describe, expect, it } from 'vitest';
import { toValidPackageName, validatePackageName } from '../src/name';

describe('validatePackageName', () => {
  it.each(['my-game', 'game2', 'a', 'my.game', 'my_game', '@me/my-game', 'x'.repeat(214)])(
    'accepts %s',
    (name) => {
      expect(validatePackageName(name)).toBeNull();
    },
  );

  it.each([
    ['', 'The name is empty.'],
    ['x'.repeat(215), 'The name is longer than 214 characters.'],
    [' game', 'The name starts or ends with spaces.'],
    ['.game', 'The name starts with "." or "_".'],
    ['_game', 'The name starts with "." or "_".'],
    ['MyGame', 'The name has uppercase letters.'],
    ['node_modules', '"node_modules" is a reserved name.'],
    ['my game', 'Use lowercase letters, digits, "-", "." and "_" (and an optional @scope/).'],
    ['my/game', 'Use lowercase letters, digits, "-", "." and "_" (and an optional @scope/).'],
  ])('rejects %j', (name, reason) => {
    expect(validatePackageName(name)).toBe(reason);
  });
});

describe('toValidPackageName', () => {
  it.each([
    ['my-game', 'my-game'],
    ['My Game', 'my-game'],
    ['  Space   Race!  ', 'space-race'],
    ['.hidden', 'hidden'],
    ['__init__', 'init__'],
    ['poker@home', 'poker-home'],
    ['!!!', ''],
  ])('turns %j into %j', (input, expected) => {
    expect(toValidPackageName(input)).toBe(expected);
  });

  it('always produces a valid name or an empty string', () => {
    for (const input of ['Hello World', 'ÜBER game', '123', 'a--b', '-x-', 'x'.repeat(300)]) {
      const name = toValidPackageName(input);
      if (name !== '') expect(validatePackageName(name)).toBeNull();
    }
  });
});
