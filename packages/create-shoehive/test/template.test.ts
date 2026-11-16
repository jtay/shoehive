import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  copyTemplate,
  render,
  targetName,
  TEMPLATES,
  TEMPLATES_DIR,
  type TemplateVars,
} from '../src/template';
import { defaultShoehiveSpec } from '../src/version';

const VARS: TemplateVars = {
  name: 'space-race',
  shoehiveVersion: '^1.2.3',
  install: 'pnpm install',
  run: 'pnpm',
};

/** The layout every template generates (the quick start docs rely on it). */
const LAYOUT = [
  '.gitignore',
  'README.md',
  'package.json',
  'src/game.ts',
  'src/server.ts',
  'test/game.test.ts',
  'tsconfig.json',
  'vite.config.ts',
  'web/App.tsx',
  'web/index.html',
  'web/main.tsx',
  'web/style.css',
];

const readJson = (path: string): Record<string, Record<string, string>> =>
  JSON.parse(readFileSync(path, 'utf8')) as Record<string, Record<string, string>>;

const temps: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'create-shoehive-test-'));
  temps.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('render', () => {
  it('replaces known placeholders and leaves the rest', () => {
    expect(render('# {{name}}\n{{run}} dev, {{ name }}, {{unknown}}', VARS)).toBe(
      '# space-race\npnpm dev, {{ name }}, {{unknown}}',
    );
  });

  it('does not read placeholders from the prototype', () => {
    expect(render('{{constructor}} {{toString}}', VARS)).toBe('{{constructor}} {{toString}}');
  });
});

describe('targetName', () => {
  it('restores files npm would strip', () => {
    expect(targetName('_gitignore')).toBe('.gitignore');
    expect(targetName('_tsconfig.json')).toBe('tsconfig.json');
    expect(targetName('game.ts')).toBe('game.ts');
  });
});

describe.each(TEMPLATES.map((t) => t.name))('the %s template', (template) => {
  it('generates the documented layout, fully rendered', async () => {
    const dest = await tempDir();
    const files = await copyTemplate(join(TEMPLATES_DIR, template), dest, VARS);
    expect(files).toEqual(LAYOUT);
    expect(existsSync(join(dest, '_gitignore'))).toBe(false);
    expect(existsSync(join(dest, '_tsconfig.json'))).toBe(false);

    for (const file of ['package.json', 'README.md', 'web/index.html']) {
      const text = await readFile(join(dest, file), 'utf8');
      expect(text, file).not.toMatch(/\{\{\w+\}\}/);
    }
    const readme = await readFile(join(dest, 'README.md'), 'utf8');
    expect(readme).toContain('# space-race');
    expect(readme).toContain('pnpm dev');
    expect(readme).toContain('https://shoehive.jtay.co.uk/tutorials/');
  });

  it('has the scripts and the shoehive dependency the docs describe', async () => {
    const dest = await tempDir();
    await copyTemplate(join(TEMPLATES_DIR, template), dest, VARS);
    const pkg = readJson(join(dest, 'package.json'));
    expect(pkg['name']).toBe('space-race');
    expect(pkg['type']).toBe('module');
    expect(Object.keys(pkg['scripts'] ?? {})).toEqual([
      'dev',
      'test',
      'typecheck',
      'build',
      'start',
    ]);
    expect(pkg['dependencies']?.['shoehive']).toBe('^1.2.3');
  });

  it('pins the same dependency versions as the examples and the repo', () => {
    const pkg = readJson(join(TEMPLATES_DIR, template, 'package.json'));
    const deps = { ...pkg['dependencies'], ...pkg['devDependencies'] };
    const repo = (path: string): string =>
      fileURLToPath(new URL(`../../../${path}`, import.meta.url));
    const example = readJson(repo('examples/tic-tac-toe/package.json'));
    const root = readJson(repo('package.json'));
    const expected = {
      ...root['devDependencies'],
      ...example['devDependencies'],
      ...example['dependencies'],
    };
    for (const [name, range] of Object.entries(deps)) {
      if (name === 'shoehive') continue;
      expect(range, name).toBe(expected[name]);
    }
  });

  it('uses no workspace aliases', () => {
    for (const file of ['vite.config.ts', '_tsconfig.json', 'package.json']) {
      const text = readFileSync(join(TEMPLATES_DIR, template, file), 'utf8');
      expect(text, file).not.toMatch(/packages\/shoehive|workspace:|alias/);
    }
  });
});

describe('the tic-tac-toe template', () => {
  // The tutorial is written against examples/tic-tac-toe: the generated game must match it.
  const withoutRegions = (text: string): string =>
    text
      .split('\n')
      .filter((line) => !/^\s*\/\/ #(end)?region\b/.test(line))
      .join('\n');

  it.each(['src/game.ts', 'test/game.test.ts', 'web/App.tsx', 'web/style.css'])(
    'has the same %s as examples/tic-tac-toe',
    (file) => {
      const example = readFileSync(
        fileURLToPath(new URL(`../../../examples/tic-tac-toe/${file}`, import.meta.url)),
        'utf8',
      );
      const template = readFileSync(join(TEMPLATES_DIR, 'tic-tac-toe', file), 'utf8');
      expect(withoutRegions(template)).toBe(withoutRegions(example));
    },
  );
});

describe('defaultShoehiveSpec', () => {
  it('is a caret range on the build version, or latest from source', () => {
    expect(defaultShoehiveSpec('1.0.0')).toBe('^1.0.0');
    expect(defaultShoehiveSpec('1.0.0-next.3')).toBe('^1.0.0-next.3');
    expect(defaultShoehiveSpec(null)).toBe('latest');
  });
});
