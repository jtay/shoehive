// Smoke test for the built package: every subpath in "exports" must load
// through both the ESM (import) and CJS (require) conditions.
// Run after `pnpm build`. Uses package self-reference, so it resolves the
// same way a consumer's install would.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const require = createRequire(import.meta.url);
const subpaths = Object.keys(pkg.exports).filter((key) => key !== './package.json');

let failures = 0;
for (const subpath of subpaths) {
  const specifier = subpath === '.' ? pkg.name : `${pkg.name}/${subpath.slice(2)}`;
  for (const [condition, load] of [
    ['import', (s) => import(s)],
    ['require', (s) => require(s)],
  ]) {
    try {
      await load(specifier);
    } catch (error) {
      failures += 1;
      console.error(
        `FAIL ${condition} ${specifier}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

if (failures > 0) {
  process.exitCode = 1;
} else {
  console.log(`OK: ${subpaths.length} subpaths load via import and require.`);
}
