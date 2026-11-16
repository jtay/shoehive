// TypeDoc plugin: names each documented module after the import path users write
// ("shoehive", "shoehive/server", "shoehive/store/sqlite") instead of the source file
// ("index", "server", "store/sqlite"). Loaded by starlight-typedoc in astro.config.mjs.
import { Converter, ReflectionKind } from 'typedoc';

/** @param {import('typedoc').Application} app */
export function load(app) {
  app.converter.on(Converter.EVENT_RESOLVE_BEGIN, (context) => {
    for (const module of context.project.getChildrenByKind(ReflectionKind.Module)) {
      module.name = module.name === 'index' ? 'shoehive' : `shoehive/${module.name}`;
    }
  });
}
