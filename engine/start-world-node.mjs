/**
 * Kernel: start a world in node — the same engine, with nothing drawing it.
 *
 * This is the parallel story. A world here needs no dev server, no port and no
 * browser tab, so many agents run one each and never touch the same mutable
 * thing. Two of them can simulate different levels at the same moment and
 * neither can see the other.
 *
 * It is deliberately the browser's twin and not its cousin: the same
 * `start-world.js`, the same plugins, the same `window.engine` surface. All
 * that differs is how the three outside things are reached — files come off
 * disk instead of over HTTP, plugins are found by reading a directory instead
 * of by a Vite glob, and project files are imported by path instead of by URL.
 * The first of those is `on-disk.mjs`; this file is the boot that uses it.
 *
 * What it cannot do is draw. There is no canvas, so no screenshot and no
 * picking. Everything else — play, simulate, tests, commands, hot reload of a
 * type — behaves exactly as it does on screen. `renderer: 'null'` adds the
 * renderer SURFACE with nothing behind it, so the draw-time commands run
 * instead of refusing; see `nullRenderer` in `null-renderer.mjs`.
 *
 * Which project it opens is a parameter: a directory path anywhere, or nothing
 * for the untitled project. The checkout is a separate parameter, because the
 * engine's own plugins and instructions are read from it whatever project is
 * open.
 */
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import fs from 'node:fs/promises'

import { makeFiles } from './files.js'
import { importPlugin } from './plugin-import.js'
import { makeHost } from './host-node.mjs'
import { startWorld } from './start-world.js'
import { PROJECT_PREFIX } from './asset-path.js'
import { ensureProject, isUntitled, projectName, resolveProject } from './project-path.mjs'
import { onDisk, refuseWritesWhileLanesWork, writesRefusedHere } from './on-disk.mjs'
import { mountNullScreen, nullRenderer } from './null-renderer.mjs'

export { onDisk, writesRefusedHere, nullRenderer }

/** The repository, found from this file, so a world starts the same from any directory. */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Every plugin file, read from the directories rather than globbed.
 *
 * `import.meta.glob` is a Vite feature and is expanded at build time. Reading
 * the directory means a plugin written a second ago is found on the next start,
 * which is the same promise the index makes about types.
 */
async function findPlugins(root, projectDirectory, loader) {
  const places = [
    { directory: path.join(root, 'plugins/builtin'), builtin: true },
    { directory: path.join(projectDirectory, 'plugins'), builtin: false }
  ]
  const found = []

  for (const { directory, builtin } of places) {
    let names = []
    try { names = await fs.readdir(directory) } catch { continue }
    for (const name of names.sort()) {
      if (!name.endsWith('.js')) continue
      const file = path.join(directory, name)
      const definition = await importPlugin({
        // Relative to the checkout, so the report names a path the reader can
        // open.
        file: path.relative(root, file).replaceAll('\\', '/'),
        load: () => import(pathToFileURL(file).href),
        loader,
        builtin
      })
      if (definition) found.push({ definition, builtin })
    }
  }
  return found
}

/** Bumped per import, so node reads the file again instead of its cached module. */
let fileVersion = 0

/**
 * Import one file out of the project.
 *
 * The changing query is why a hot reload works here too: node caches a module
 * by URL forever, so re-importing the same path would hand back the version
 * read at start-up and a live edit would appear to do nothing.
 */
const importProjectFileFrom = projectDirectory => async file =>
  (await import(pathToFileURL(path.join(projectDirectory, file)).href + `?hot=${++fileVersion}`)).default || {}

/**
 * Start the same world in node, where files come off disk and nothing draws.
 *
 * @param {string} [root] The checkout. The engine's own plugins and guides
 *                 live here.
 * @param {string} [project] The game's directory, as a path resolved against
 *                 the checkout. A bare name reaches a directory inside it;
 *                 `../x` or an absolute path reaches one anywhere else. Nothing
 *                 given opens the untitled project.
 * @param {string} [renderer] `'null'` attaches the drawing surface described
 *                 above. Anything else leaves the world with no renderer, so the
 *                 draw-time commands refuse and name the headless verb that
 *                 answers instead — the right answer for an agent at a
 *                 terminal, and the wrong one for a test of the restore path.
 * @param {object} [viewport] A measured screen, overriding the game's device.
 * @returns {Promise<object>} The started world's surface.
 */
export async function startWorldInNode({ root = ROOT, project, viewport, renderer } = {}) {
  const checkout = path.resolve(root)
  const projectDirectory = resolveProject(checkout, project)
  await ensureProject(projectDirectory)

  return startWorld({
    openFiles: bus => {
      const files = makeFiles(bus, onDisk(projectDirectory, checkout))
      files.guardWrites(refuseWritesWhileLanesWork(checkout))
      return files
    },
    loadPlugins: loader => findPlugins(checkout, projectDirectory, loader),
    importProjectFile: importProjectFileFrom(projectDirectory),
    // Only a node world has one. A plugin that needs an outside program reads
    // its absence in the browser and answers with the terminal command.
    host: makeHost({ project: projectDirectory, checkout }),
    // The canonical prefix, not the disk path. A plugin builds
    // `project/plugins` from it to name a file, and that name has to be the
    // same in both halves — the browser reaches the project only through the
    // `/project/` mount and never learns where it is on disk.
    projectDirectory: PROJECT_PREFIX,
    projectName: projectName(projectDirectory),
    projectUntitled: isUntitled(projectDirectory),
    ...(viewport ? { viewport } : {}),
    // The same hook the browser mounts its shell and renderer through, so the
    // two halves attach a renderer at one point in the start-up order.
    ...(renderer === 'null' ? { attachScreen: mountNullScreen } : {})
  })
}
