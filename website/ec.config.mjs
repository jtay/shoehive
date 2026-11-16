// @ts-check
// Expressive Code options live here (not in astro.config.mjs) so the <Code> component, used by
// <Snippet>, can load them too.
import { defineEcConfig } from '@astrojs/starlight/expressive-code';
import { cutPlugin } from './src/lib/expressive-code-cut.mjs';

export default defineEcConfig({
  plugins: [cutPlugin()],
});
