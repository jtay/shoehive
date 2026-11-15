// @ts-check
// Astro integration: after `astro build`, list the pages that are still stubs (frontmatter
// `todo:`), so content writers can find them. Set SHOEHIVE_DOCS_STRICT=1 to fail the build
// while any stub remains (for the 1.0 release).
import { todoPages } from './pages.ts';

/** @returns {import('astro').AstroIntegration} */
export function todoReport() {
  return {
    name: 'shoehive-todo-report',
    hooks: {
      'astro:build:done': ({ logger }) => {
        const pages = todoPages();
        if (pages.length === 0) {
          logger.info('No TODO pages left.');
          return;
        }
        logger.warn(`${String(pages.length)} pages are stubs (frontmatter "todo:"):`);
        for (const page of pages) logger.warn(`  TODO ${page.file}: ${page.title}`);
        if (process.env['SHOEHIVE_DOCS_STRICT'] === '1') {
          throw new Error('SHOEHIVE_DOCS_STRICT=1 and stub pages remain.');
        }
      },
    },
  };
}
