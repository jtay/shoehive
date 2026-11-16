import { describe, expect, it } from 'vitest';
import { commandsFor, detectPackageManager } from '../src/package-manager';

describe('detectPackageManager', () => {
  it.each([
    ['npm/10.9.2 node/v22.20.0 linux x64 workspaces/false', 'npm'],
    ['pnpm/10.28.0 npm/? node/v22.20.0 linux x64', 'pnpm'],
    ['yarn/1.22.22 npm/? node/v22.20.0 darwin arm64', 'yarn'],
    ['yarn/4.9.1 npm/? node/v24.1.0 linux x64', 'yarn'],
    ['bun/1.2.15 npm/? node/v24.3.0 linux x64', 'bun'],
  ] as const)('reads %s', (userAgent, expected) => {
    expect(detectPackageManager(userAgent)).toBe(expected);
  });

  it('defaults to npm', () => {
    expect(detectPackageManager(undefined)).toBe('npm');
    expect(detectPackageManager('')).toBe('npm');
    expect(detectPackageManager('deno/2.3.0')).toBe('npm');
  });
});

describe('commandsFor', () => {
  it('uses the install and run commands of each tool', () => {
    expect(commandsFor('npm')).toEqual({
      install: 'npm install',
      installArgv: ['npm', 'install'],
      run: 'npm run',
    });
    expect(commandsFor('pnpm')).toMatchObject({ install: 'pnpm install', run: 'pnpm' });
    expect(commandsFor('yarn')).toMatchObject({
      install: 'yarn',
      installArgv: ['yarn', 'install'],
      run: 'yarn',
    });
    expect(commandsFor('bun')).toMatchObject({ install: 'bun install', run: 'bun run' });
  });
});
