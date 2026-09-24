/**
 * Kernel: find the plugins, decide which run, and boot them.
 *
 * Discovery is the caller's job — a glob in the browser, readdir in node — so
 * the same boot runs in both halves. A plugin that is off must have never run,
 * so the disabled list is applied before boot.
 */

/**
 * Load the plugins, register them in dependency order, and boot the enabled
 * ones.
 *
 * @param {object} parts
 * @param {object} parts.loader The plugin registry.
 * @param {Function} parts.loadPlugins `async (loader) => [{ definition, builtin }]`.
 * @param {object} parts.game The parsed `game.json`.
 * @param {object} parts.context The context a plugin's `onLoad` receives.
 * @returns {Promise<void>}
 */
export async function bootPlugins({ loader, loadPlugins, game, context }) {
  const found = await loadPlugins(loader)
  // Where a plugin was found travels beside it rather than being guessed from
  // its name later. Sorting works on definitions, so the flag is carried in a
  // side map instead of being copied onto the definition itself.
  const cameFromBuiltin = new Map(found.map(entry => [entry.definition, entry.builtin === true]))
  for (const definition of loader.order(found.map(entry => entry.definition))) {
    loader.add(definition, { builtin: cameFromBuiltin.get(definition) === true })
  }

  // Turning a plugin off has to mean it never ran, so the list is applied
  // before boot.
  for (const name of game.plugins?.disabled || []) loader.enable(name, false)

  loader.boot(context)
}
