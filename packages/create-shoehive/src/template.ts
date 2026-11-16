import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The templates shipped in the package, in the order `--help` lists them. */
export const TEMPLATES = [
  { name: 'tic-tac-toe', description: 'two players, turns, a React board (default)' },
  { name: 'blank', description: 'a minimal one-action game with the same layout' },
] as const;
export type TemplateName = (typeof TEMPLATES)[number]['name'];
export const DEFAULT_TEMPLATE: TemplateName = 'tic-tac-toe';

export function isTemplateName(value: string): value is TemplateName {
  return TEMPLATES.some((t) => t.name === value);
}

/**
 * `templates/` next to `dist/` in the published package, and next to `src/` in the repo.
 * Both are one level below the package root.
 */
export const TEMPLATES_DIR = fileURLToPath(new URL('../templates', import.meta.url));

/** Values substituted for `{{key}}` in rendered files. */
export interface TemplateVars {
  /** The package name. */
  name: string;
  /** The npm version spec for `shoehive`. */
  shoehiveVersion: string;
  /** Installs dependencies, for example `npm install`. */
  install: string;
  /** Runs a script, for example `npm run`. */
  run: string;
}

/**
 * Files stored under another name. npm never publishes a `.gitignore`. And `tsconfig.json`
 * would hide `templates/tsconfig.json`, which type-checks the templates inside the repo.
 */
const RENAMES: Record<string, string> = {
  _gitignore: '.gitignore',
  '_tsconfig.json': 'tsconfig.json',
};

/** Only these files contain `{{placeholders}}`. Source files are copied byte for byte. */
const RENDERED_EXTENSIONS = new Map<string, RenderEscape>([
  ['.json', 'json'],
  ['.md', 'none'],
  ['.html', 'html'],
]);

/** Never copied, in case a template was run in place during development. */
const SKIPPED = new Set(['node_modules', 'dist', 'dist-web', '.DS_Store']);

/** How a substituted value is escaped: inside a JSON string, in HTML, or as is. */
export type RenderEscape = 'json' | 'html' | 'none';

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const ESCAPERS: Record<RenderEscape, (value: string) => string> = {
  // Placeholders in JSON files sit inside a string literal: `"shoehive": "{{shoehiveVersion}}"`.
  json: (value) => JSON.stringify(value).slice(1, -1),
  html: (value) => value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!),
  none: (value) => value,
};

/**
 * Replaces `{{key}}` for every key in `vars`, escaped for the file type, so a value such
 * as a `--shoehive` spec cannot add keys to `package.json`. Unknown placeholders are left
 * alone.
 */
export function render(text: string, vars: TemplateVars, escape: RenderEscape = 'none'): string {
  const escaped = ESCAPERS[escape];
  return text.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    Object.hasOwn(vars, key) ? escaped(vars[key as keyof TemplateVars]) : match,
  );
}

/** The name a template file gets in the generated project. */
export function targetName(fileName: string): string {
  return RENAMES[fileName] ?? fileName;
}

/**
 * Copies a template into `dest` (which must exist), renaming and rendering files.
 * Returns the generated files' relative paths, sorted, with `/` separators.
 */
export async function copyTemplate(
  templateDir: string,
  dest: string,
  vars: TemplateVars,
): Promise<string[]> {
  if (!existsSync(templateDir)) throw new Error(`Template not found: ${templateDir}`);
  const written: string[] = [];

  const walk = async (from: string, to: string, prefix: string): Promise<void> => {
    await mkdir(to, { recursive: true });
    const entries = await readdir(from, { withFileTypes: true });
    for (const entry of entries) {
      if (SKIPPED.has(entry.name)) continue;
      const name = targetName(entry.name);
      const source = join(from, entry.name);
      const target = join(to, name);
      if (entry.isDirectory()) {
        await walk(source, target, `${prefix}${name}/`);
      } else if (entry.isFile()) {
        const escape = RENDERED_EXTENSIONS.get(extname(entry.name));
        if (escape !== undefined) {
          await writeFile(target, render(await readFile(source, 'utf8'), vars, escape));
        } else {
          await copyFile(source, target);
        }
        written.push(`${prefix}${name}`);
      }
    }
  };

  await walk(templateDir, dest, '');
  return written.sort();
}
