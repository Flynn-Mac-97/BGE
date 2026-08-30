/**
 * Start a world in node — the same engine, with nothing drawing it.
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
 *
 * What it cannot do is draw. There is no canvas, so no screenshot and no
 * picking. Everything else — play, simulate, tests, commands, hot reload of a
 * type — behaves exactly as it does on screen.
 *
 * Which project it opens is a parameter, defaulting to `project`. It must be a
 * directory inside the checkout — see `startWorldInNode` at the bottom for why
 * a second root would be worse than one rule.
 */
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import fs from 'node:fs/promises'

import { makeFiles } from './files.js'
import { startWorld } from './start-world.js'
import { buildIndex, walk } from './project-index.mjs'

/** The repository, found from this file, so a world starts the same from any directory. */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Reach the project directly rather than through the dev server.
 *
 * Writes rebuild the index, exactly as the server's POST handler does, so a
 * headless session that writes a level sees the new index on the next read.
 * Skipping that is how a world ends up acting on a project that no longer
 * exists.
 */
export function onDisk(projectDirectory) {
  const root = path.dirname(projectDirectory)
  const inside = rel => {
    const abs = path.resolve(projectDirectory, rel)
    // Same guard the dev server applies. A path that climbs out of the project
    // is a bug wherever it came from, and answering it quietly would make the
    // headless runner the weaker door.
    if (abs !== projectDirectory && !abs.startsWith(projectDirectory + path.sep)) {
      throw new Error(`path outside project: ${rel}`)
    }
    return abs
  }

  const insideAgent = (scope, rel) => {
    const base = scope === 'engine' ? root : scope === 'project' ? projectDirectory : null
    const clean = String(rel || '').replaceAll('\\', '/').replace(/^\.\//, '')
    const allowed = scope === 'engine'
      ? clean === 'AGENTS.md' || clean === 'ENGINE-BASE.md' || clean === 'ARCHITECTURE.md' || clean.startsWith('agents/') || clean.startsWith('docs/') || /^plugins\/builtin\/[^/]+\.agent\.md$/.test(clean)
      : clean.startsWith('agents/') || /^plugins\/[^/]+\.agent\.md$/.test(clean)
    if (!base || !allowed) throw new Error(`bad agent file path: ${scope}:${rel}`)
    const abs = path.resolve(base, clean)
    if (!abs.startsWith(base + path.sep)) throw new Error(`bad agent file path: ${scope}:${rel}`)
    return abs
  }

  const pluginSidecars = async () => {
    const game = JSON.parse(await fs.readFile(path.join(projectDirectory, 'game.json'), 'utf8').catch(() => '{}'))
    const disabled = new Set(game.plugins?.disabled || [])
    const places = [
      { scope: 'engine', directory: path.join(root, 'plugins/builtin'), prefix: 'plugins/builtin' },
      { scope: 'project', directory: path.join(projectDirectory, 'plugins'), prefix: 'plugins' }
    ]
    const found = []
    for (const place of places) {
      let names = []
      try { names = await fs.readdir(place.directory) } catch { continue }
      for (const name of names.filter(name => name.endsWith('.agent.md')).sort()) {
        const stem = name.slice(0, -'.agent.md'.length)
        const source = await fs.readFile(path.join(place.directory, `${stem}.js`), 'utf8').catch(() => '')
        const plugin = source.match(/export\s+default\s+\{[\s\S]*?\bname:\s*['"]([^'"]+)['"]/m)?.[1] || stem
        // A guide applies to its own plugin by default. A leading frontmatter
        // `match:` (space-separated paths) adds more — Plugin Master uses it to
        // ride along with every plugin task.
        const guide = await fs.readFile(path.join(place.directory, name), 'utf8').catch(() => '')
        const declared = guide.match(/^---\s*\n([\s\S]*?)\n---/)?.[1]
        const extra = declared?.match(/^match:\s*(.+)$/m)?.[1]?.trim().split(/\s+/).filter(Boolean) || []
        // A guide may declare its own trigger words (comma-separated) — the
        // same reading the dev server makes, or the two twins route
        // differently.
        const saidTriggers = declared?.match(/^triggers:\s*(.+)$/m)?.[1]?.split(',').map(word => word.trim().toLowerCase()).filter(Boolean) || []
        // Named from the project directory in use, not the literal `project`.
        // A guide whose match path points into the other project attaches to
        // tasks about a file that is not there, and never to the real one.
        const match = [...new Set([
          `${place.scope === 'project' ? path.basename(projectDirectory) + '/' : ''}${place.prefix}/${stem}.js`,
          ...extra
        ])]
        found.push({
          id: `plugin-${place.scope}-${stem}`, title: plugin, kind: 'instruction', parent: 'plugins',
          scope: place.scope, file: `${place.prefix}/${name}`,
          match,
          triggers: [...new Set([stem.replaceAll('-', ' '), plugin.toLowerCase(), ...saidTriggers])],
          enabled: !disabled.has(plugin), plugin
        })
      }
    }
    return found
  }

  return {
    index: () => buildIndex(projectDirectory),
    tree: async () => (await walk(projectDirectory))
      .filter(f => !f.startsWith('.engine'))
      .map(f => ({ path: f })),
    agentPlugins: pluginSidecars,
    read: rel => fs.readFile(inside(rel), 'utf8'),
    readAgent: (scope, rel) => fs.readFile(insideAgent(scope, rel), 'utf8'),
    async write(rel, text) {
      const abs = inside(rel)
      await fs.mkdir(path.dirname(abs), { recursive: true })
      await fs.writeFile(abs, text, 'utf8')
      await buildIndex(projectDirectory)
    },
    async writeAgent(scope, rel, text) {
      const abs = insideAgent(scope, rel)
      await fs.mkdir(path.dirname(abs), { recursive: true })
      await fs.writeFile(abs, text, 'utf8')
      if (scope === 'project') await buildIndex(projectDirectory)
    }
  }
}

/**
 * Every plugin file, read from the directories rather than globbed.
 *
 * `import.meta.glob` is a Vite feature and is expanded at build time. Reading
 * the directory means a plugin written a second ago is found on the next start,
 * which is the same promise the index makes about types.
 */
async function findPlugins(root, projectDirectory) {
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
      try {
        const definition = (await import(pathToFileURL(file).href)).default
        if (!definition) continue
        found.push({ definition, builtin })
      } catch (e) {
        console.error(`[loader] ${file} failed to import`, e)
      }
    }
  }
  return found
}

/**
 * Import one file out of the project.
 *
 * The changing query is why a hot reload works here too: node caches a module
 * by URL forever, so re-importing the same path would hand back the version
 * read at start-up and a live edit would appear to do nothing.
 */
let fileVersion = 0
const importProjectFileFrom = projectDirectory => async file =>
  (await import(pathToFileURL(path.join(projectDirectory, file)).href + `?hot=${++fileVersion}`)).default || {}

/**
 * @param root     the checkout. The engine's own plugins and guides live here.
 * @param project  which directory inside it holds the game. `project` by
 *                 default, so a call that names nothing starts the world it
 *                 always started.
 */
export async function startWorldInNode({ root = ROOT, project = 'project', viewport } = {}) {
  const checkout = path.resolve(root)
  const projectDirectory = path.resolve(checkout, project)

  // The project has to be a child of the checkout, and this says so out loud.
  // `onDisk` finds the engine root back from the project by taking its parent,
  // and every agent-file path is resolved against that — so a project anywhere
  // else would give two roots that can disagree, and the world would read its
  // own instructions out of the wrong tree while reading its levels from here.
  if (path.dirname(projectDirectory) !== checkout) {
    throw new Error(`project must be a directory directly inside ${checkout} — got ${projectDirectory}`)
  }

  return startWorld({
    openFiles: bus => makeFiles(bus, onDisk(projectDirectory)),
    loadPlugins: () => findPlugins(checkout, projectDirectory),
    importProjectFile: importProjectFileFrom(projectDirectory),
    // The name, not the absolute path: a plugin builds `<project>/plugins` from
    // it, and the browser half only ever knows the name.
    projectDirectory: path.basename(projectDirectory),
    ...(viewport ? { viewport } : {})
  })
}
