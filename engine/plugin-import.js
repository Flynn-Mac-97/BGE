/**
 * Kernel: importing one plugin file, and what happens when it will not.
 *
 * There are two plugin finders — the browser expands a Vite glob, node reads a
 * directory — and this is the half they have to agree on. A file that throws on
 * import contributes nothing, so every command it owns reads as missing and the
 * only symptom is the name of one of them. The failure is told to the loader,
 * which can still answer for it an hour later, instead of to a console that has
 * scrolled away.
 *
 * One rule, in one place, because the two finders are twins by discipline
 * alone: written twice, half of it goes on being wrong.
 *
 * Nothing here touches a document or a URL, so both halves can use it.
 */

/**
 * Say that a plugin file could not be used, and why.
 *
 * The loader is the only place a failure like this can live: it has no plugin
 * name to it, so nothing else could answer for it when a command turns up
 * missing later. Called without a loader there is nowhere to put it and only
 * the console is left — which is where it used to go, and no worse than that.
 */
export function reportImportFailure(loader, file, error, { builtin = false } = {}) {
  if (loader) loader.failedImport(file, error, { builtin })
  else console.error(`[loader] ${file} failed to import`, error)
}

/** Where a definition was found, keyed by the definition so a plugin cannot claim another's location. */
const sources = new WeakMap()

/** The location `importPlugin` recorded for a definition, or null when it did not import it. */
export const sourceOfPlugin = definition => (definition ? sources.get(definition) || null : null)

/**
 * Import one plugin file. Returns its definition, or null when there is none —
 * because the file threw, or because it exports nothing.
 *
 * @param file    the path to name in a report, written the way a person types it
 * @param load    () => the module. The browser has a URL, node has a path.
 * @param loader  told about a file that would not import.
 * @param builtin where the file was found, not something the plugin may claim.
 */
export async function importPlugin({ file, load, loader, builtin = false }) {
  try {
    const definition = (await load()).default || null
    if (definition && typeof definition === 'object') {
      const path = String(file).replaceAll('\\', '/')
      sources.set(
        definition,
        builtin
          ? { scope: 'engine', file: path.replace(/^\//, '') }
          : { scope: 'project', file: 'plugins/' + path.split('/').pop() }
      )
    }
    return definition
  } catch (error) {
    reportImportFailure(loader, file, error, { builtin })
    return null
  }
}
