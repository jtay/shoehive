// Checks what `npm publish` would ship for create-shoehive. Run after `pnpm build`.
//
// - The bin runs and reports this package's version.
// - Every template file is packed, including the renamed dotfiles npm would otherwise drop.
// - Nothing from src/, test/ or scripts/ is packed.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
let failures = 0;
const fail = (message) => {
  failures += 1;
  console.error(`FAIL ${message}`);
};

const version = execFileSync(
  process.execPath,
  [join(root, pkg.bin['create-shoehive']), '--version'],
  {
    encoding: 'utf8',
  },
).trim();
if (version !== pkg.version) fail(`the bin reports ${version}, expected ${pkg.version}`);

const [report] = JSON.parse(
  execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: root,
    encoding: 'utf8',
  }),
);
const packed = new Set(report.files.map((file) => file.path));

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [relative(root, path).split(sep).join('/')];
  });
// templates/tsconfig.json only type-checks the templates inside the repo.
const templateFiles = walk(join(root, 'templates')).filter((f) => f !== 'templates/tsconfig.json');
for (const file of [...templateFiles, 'dist/index.js', 'package.json', 'README.md', 'LICENSE']) {
  if (!packed.has(file)) fail(`${file} is not packed`);
}
for (const file of packed) {
  if (/^(src|test|scripts)\//.test(file)) fail(`${file} should not be packed`);
}
if (packed.has('templates/tsconfig.json')) fail('templates/tsconfig.json should not be packed');
for (const name of ['_gitignore', '_tsconfig.json']) {
  if (!templateFiles.some((file) => file.endsWith(`/${name}`))) fail(`no template has ${name}`);
}

if (failures > 0) process.exit(1);
console.log(`create-shoehive package OK: ${String(packed.size)} files, version ${version}`);
