import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { nextSteps, run, USAGE, type RunOptions } from '../src/cli';

const temps: string[] = [];
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

interface Call {
  command: string;
  args: readonly string[];
  cwd: string;
}

/** Runs the CLI in a fresh temp dir with fake I/O. `gitInsideRepo` fakes `git rev-parse`. */
async function cli(
  argv: string[],
  options: Partial<RunOptions> & { gitInsideRepo?: boolean; installCode?: number } = {},
): Promise<{ code: number; out: string; err: string; calls: Call[]; cwd: string }> {
  const cwd = await mkdtemp(join(tmpdir(), 'create-shoehive-cli-'));
  temps.push(cwd);
  const out: string[] = [];
  const err: string[] = [];
  const calls: Call[] = [];
  const code = await run({
    argv,
    cwd,
    env: {},
    interactive: false,
    log: (line) => out.push(line),
    error: (line) => err.push(line),
    exec: (command, args, dir) => {
      calls.push({ command, args, cwd: dir });
      if (command === 'git' && args[0] === 'rev-parse') return options.gitInsideRepo ? 0 : 128;
      if (args[0] === 'install') return options.installCode ?? 0;
      return 0;
    },
    ...options,
  });
  return { code, out: out.join('\n'), err: err.join('\n'), calls, cwd };
}

describe('run', () => {
  it('prints usage and the version', async () => {
    const help = await cli(['--help']);
    expect(help.code).toBe(0);
    expect(help.out).toBe(USAGE);
    expect(USAGE).toContain('--template <name>');
    expect(USAGE).toContain('--no-install');
    expect(USAGE).toContain('--package-manager <name>');
    expect(USAGE).toContain('--shoehive <spec>');
    expect(USAGE).toContain('--yes');
    const version = await cli(['--version']);
    expect(version.out).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('creates my-game by default without prompting, installs with npm and runs git init', async () => {
    const { code, out, calls, cwd } = await cli([]);
    expect(code).toBe(0);
    const root = join(cwd, 'my-game');
    expect(existsSync(join(root, 'src/game.ts'))).toBe(true);
    expect(existsSync(join(root, '.gitignore'))).toBe(true);
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      name: string;
      dependencies: Record<string, string>;
    };
    expect(pkg.name).toBe('my-game');
    // From source there is no build-time version.
    expect(pkg.dependencies['shoehive']).toBe('latest');
    expect(calls.map((c) => [c.command, ...c.args].join(' '))).toEqual([
      'git --version',
      'git rev-parse --is-inside-work-tree',
      'git init --quiet',
      'npm install',
    ]);
    expect(calls.every((c) => c.cwd === root)).toBe(true);
    expect(out).toContain('Installing dependencies with npm...');
    expect(out).toContain(
      [
        'Done. Next steps:',
        '',
        '  cd my-game',
        '  npm run dev',
        '',
        'Then open http://localhost:5173 in two browser windows, one of them private so that each',
        'window is a different player, and play.',
        '',
        'Tutorials: https://shoehive.jtay.co.uk/tutorials/tic-tac-toe/',
      ].join('\n'),
    );
  });

  it('honours --template, --shoehive, --no-install, --no-git and the detected package manager', async () => {
    const { code, out, calls, cwd } = await cli(
      [
        'Space Race',
        '--template',
        'blank',
        '--shoehive',
        'file:/tmp/shoehive.tgz',
        '--no-install',
        '--no-git',
      ],
      { env: { npm_config_user_agent: 'pnpm/10.28.0 npm/? node/v22.20.0 linux x64' } },
    );
    expect(code).toBe(0);
    expect(calls).toEqual([]);
    const root = join(cwd, 'Space Race');
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      name: string;
      dependencies: Record<string, string>;
    };
    expect(pkg.name).toBe('space-race');
    expect(pkg.dependencies['shoehive']).toBe('file:/tmp/shoehive.tgz');
    expect(readFileSync(join(root, 'src/game.ts'), 'utf8')).toContain("id: 'my-game'");
    expect(out).toContain('  cd "Space Race"\n  pnpm install\n  pnpm dev');
  });

  it('skips git init inside an existing repository', async () => {
    const { calls } = await cli(['game', '--no-install'], { gitInsideRepo: true });
    expect(calls.map((c) => c.args[0])).toEqual(['--version', 'rev-parse']);
  });

  it('asks for the directory when interactive', async () => {
    const questions: string[] = [];
    const { code, cwd } = await cli(['--no-install', '--no-git'], {
      interactive: true,
      prompt: (question) => {
        questions.push(question);
        return Promise.resolve(questions.length === 1 ? '!!!' : 'chess-club');
      },
    });
    expect(code).toBe(0);
    expect(questions).toEqual(['Project directory (my-game): ', 'Project directory (my-game): ']);
    expect(existsSync(join(cwd, 'chess-club/package.json'))).toBe(true);
  });

  it('does not prompt with --yes', async () => {
    const { code, cwd } = await cli(['--yes', '--no-install', '--no-git'], {
      interactive: true,
      prompt: () => Promise.reject(new Error('should not prompt')),
    });
    expect(code).toBe(0);
    expect(existsSync(join(cwd, 'my-game/package.json'))).toBe(true);
  });

  it('scaffolds into the current directory with "."', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'create-shoehive-dot-'));
    temps.push(cwd);
    const project = join(cwd, 'dot-game');
    await mkdir(join(project, '.git'), { recursive: true });
    const { code, out } = await cli(['.', '--no-git', '--package-manager', 'yarn'], {
      cwd: project,
    });
    expect(code).toBe(0);
    expect(out).toContain('Done. Next steps:\n\n  yarn dev\n');
    const pkg = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8')) as { name: string };
    expect(pkg.name).toBe('dot-game');
  });

  it('refuses a directory that is not empty', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'create-shoehive-full-'));
    temps.push(cwd);
    await mkdir(join(cwd, 'taken'));
    await writeFile(join(cwd, 'taken/notes.txt'), 'mine');
    const { code, err } = await cli(['taken'], { cwd });
    expect(code).toBe(1);
    expect(err).toContain('is not empty. Choose a new or empty directory.');
    expect(readFileSync(join(cwd, 'taken/notes.txt'), 'utf8')).toBe('mine');
  });

  it('reports usage errors with exit code 1', async () => {
    const unknown = await cli(['--template', 'chess']);
    expect(unknown.code).toBe(1);
    expect(unknown.err).toContain('Unknown template "chess". Use one of: tic-tac-toe, blank.');
    const badName = await cli(['!!!', '--no-install']);
    expect(badName.code).toBe(1);
    expect(badName.err).toContain('Cannot make a package name from "!!!"');
  });

  it('exits 1 and still shows the next steps when the install fails', async () => {
    const { code, out, err } = await cli(['game'], { installCode: 1 });
    expect(code).toBe(1);
    expect(err).toContain('npm install failed.');
    expect(out).toContain('  cd game\n  npm install\n  npm run dev');
  });
});

describe('nextSteps', () => {
  it('adapts to each package manager', () => {
    const base = {
      cwd: '/work',
      root: '/work/my-game',
      template: 'tic-tac-toe',
      installed: true,
    } as const;
    expect(nextSteps({ ...base, pm: 'npm' })).toContain('  cd my-game\n  npm run dev\n');
    expect(nextSteps({ ...base, pm: 'pnpm' })).toContain('  cd my-game\n  pnpm dev\n');
    expect(nextSteps({ ...base, pm: 'yarn' })).toContain('  cd my-game\n  yarn dev\n');
    expect(nextSteps({ ...base, pm: 'bun' })).toContain('  cd my-game\n  bun run dev\n');
    expect(nextSteps({ ...base, pm: 'bun', installed: false })).toContain(
      '  cd my-game\n  bun install\n  bun run dev\n',
    );
  });
});
