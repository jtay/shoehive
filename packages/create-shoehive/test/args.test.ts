import { describe, expect, it } from 'vitest';
import { parseArgs, UsageError } from '../src/args';

describe('parseArgs', () => {
  it('has defaults for no arguments', () => {
    expect(parseArgs([])).toEqual({
      dir: undefined,
      template: undefined,
      install: true,
      git: true,
      packageManager: undefined,
      shoehive: undefined,
      yes: false,
      help: false,
      version: false,
    });
  });

  it('reads the directory and every option', () => {
    const args = parseArgs([
      'my-game',
      '--template',
      'blank',
      '--no-install',
      '--no-git',
      '--package-manager',
      'pnpm',
      '--shoehive',
      'file:../shoehive-1.0.0.tgz',
      '--yes',
    ]);
    expect(args).toMatchObject({
      dir: 'my-game',
      template: 'blank',
      install: false,
      git: false,
      packageManager: 'pnpm',
      shoehive: 'file:../shoehive-1.0.0.tgz',
      yes: true,
    });
  });

  it('accepts --flag=value, short flags and aliases', () => {
    expect(parseArgs(['-t=blank', '--pm=bun', '-y', 'game'])).toMatchObject({
      dir: 'game',
      template: 'blank',
      packageManager: 'bun',
      yes: true,
    });
    expect(parseArgs(['-t', 'tic-tac-toe']).template).toBe('tic-tac-toe');
    expect(parseArgs(['--shoehive=^1.0.0-next.3']).shoehive).toBe('^1.0.0-next.3');
    expect(parseArgs(['-h']).help).toBe(true);
    expect(parseArgs(['--version']).version).toBe(true);
  });

  it('lets a later flag win', () => {
    expect(parseArgs(['--no-install', '--install']).install).toBe(true);
    expect(parseArgs(['--template', 'blank', '--template', 'tic-tac-toe']).template).toBe(
      'tic-tac-toe',
    );
  });

  it('takes everything after -- as positionals', () => {
    expect(parseArgs(['--', '--weird-dir']).dir).toBe('--weird-dir');
  });

  it('rejects unknown options, missing values and extra directories', () => {
    expect(() => parseArgs(['--frobnicate'])).toThrow(UsageError);
    expect(() => parseArgs(['--template'])).toThrow('--template needs a value.');
    expect(() => parseArgs(['--template', '--yes'])).toThrow('--template needs a value.');
    expect(() => parseArgs(['--template='])).toThrow('--template needs a value.');
    expect(() => parseArgs(['--yes=no'])).toThrow('--yes does not take a value.');
    expect(() => parseArgs(['a', 'b'])).toThrow('Expected one directory, got 2: a b.');
  });

  it('rejects an unknown package manager', () => {
    expect(() => parseArgs(['--package-manager', 'pip'])).toThrow(
      'Unknown package manager "pip". Use one of: npm, pnpm, yarn, bun.',
    );
  });
});
