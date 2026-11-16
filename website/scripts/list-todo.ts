// Lists the stub pages that still need writing (frontmatter `todo:`).
//   pnpm --filter @shoehive/website todo            list them
//   pnpm --filter @shoehive/website todo --strict   also fail if any remain (for the 1.0 release)
import { todoPages } from '../src/lib/pages';

const pages = todoPages();
for (const page of pages) console.log(`TODO ${page.file}\n     ${page.title}: ${page.todo}`);
console.log(`\n${String(pages.length)} stub page(s).`);
if (process.argv.includes('--strict') && pages.length > 0) process.exit(1);
