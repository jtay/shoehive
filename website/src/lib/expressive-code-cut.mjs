// Expressive Code plugin: hides the set-up part of an inline code block.
//
// Everything up to and including a line that is exactly `// ---cut---` is type-checked by
// scripts/check-snippets.ts but not shown on the page. Use it to declare the values a short
// example needs (`declare const games: AnyGame[];`) without cluttering the example.

export const CUT_MARKER = '// ---cut---';
const TS_LANGS = new Set(['ts', 'tsx', 'typescript', 'mts', 'cts']);

/** @returns {import('@astrojs/starlight/expressive-code').ExpressiveCodePlugin} */
export function cutPlugin() {
  return {
    name: 'shoehive-cut',
    hooks: {
      preprocessCode({ codeBlock }) {
        if (!TS_LANGS.has(codeBlock.language)) return;
        const lines = codeBlock.getLines();
        const cut = lines.findIndex((line) => line.text.trim() === CUT_MARKER);
        if (cut === -1) return;
        codeBlock.deleteLines(Array.from({ length: cut + 1 }, (_, i) => i));
      },
    },
  };
}
