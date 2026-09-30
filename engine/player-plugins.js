/**
 * The builtin plugins an exported game bundles, as `file → () => import()`.
 *
 * Empty here. `export-game.mjs` replaces this module's text while it builds, with
 * the runtime plugins it chose, so only those are bundled into the game.
 */
export const builtinPlugins = {}
