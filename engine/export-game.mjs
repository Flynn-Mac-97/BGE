/**
 * Export a game: one project as a static web build that plays with no editor
 * and no server of ours. Any static host serves it: itch.io, GitHub Pages, a
 * folder behind `npx serve`. Opened as a `file://` page it does not run,
 * because browsers refuse module scripts there.
 *
 * The build is `player.html` and `engine/player.js`, bundled by Vite with only
 * the runtime plugins (categories `engine`, `visuals` and `game`, less the two
 * that only matter while editing and any the game's `game.json` turns off; or
 * only those in its `plugins.only`, with what they require), then the game's own runtime files copied
 * beside it under `project/`, with the index and file list the player reads in
 * place of a dev server. Editor and agent plugins are left out.
 *
 * Output:
 *
 *   index.html  assets/…            the engine and plugins, bundled
 *   project/…                       game.json, types, behaviours, levels, assets, plugins
 *   project-index.json              the project index the world boots from
 *   project-tree.json               every copied file, for plugins that list them
 *   .engine-export                  marks the folder as an export, so a later export may replace it
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'vite'
import { KIND, buildIndex, walk } from './project-index.mjs'
import { writeWebApp } from './export-web-app.mjs'

/** The plugin categories a game runs with. `editor` and `agents` are the editor's. */
export const RUNTIME_CATEGORIES = new Set(['engine', 'visuals', 'game'])

/**
 * Plugins in a runtime category that only matter while editing: Live File
 * Updates needs the dev server, and Plugin Master describes plugins for their
 * authors (and bundles a source parser a game never uses).
 */
const EDITING_ONLY = new Set(['Live File Updates', 'Plugin Master'])

/** The project folders a game reads while it plays. */
const RUNTIME_FOLDERS = ['types/', 'behaviours/', 'levels/', 'assets/', 'plugins/']

/** Source files kept beside assets that a game never loads: Blender sources and plugin guides. */
const SOURCE_ONLY = /\.(blend|blend1|md)$/

/** The file that marks a folder as an export. */
const MARK = '.engine-export'

/** Whether a built game carries this project file, by its path from the project. */
export const isRuntimeFile = file =>
  file === 'game.json' || (RUNTIME_FOLDERS.some(folder => file.startsWith(folder)) && !SOURCE_ONLY.test(file))

/**
 * The builtin plugins an export bundles: each file whose plugin has a runtime
 * category and is not turned off by name in `game.json`'s `plugins.disabled`.
 * Answers `[{ file, name, category }]`, `file` from the checkout.
 *
 * A game that lists `plugins.only` in `game.json` gets just those plugins, plus
 * every runtime plugin that provides a service one of them requires.
 */
export async function runtimePlugins(checkout, game = {}) {
  const disabled = new Set(game.plugins?.disabled ?? [])
  const directory = path.join(checkout, 'plugins/builtin')
  const files = (await fs.readdir(directory)).filter(name => name.endsWith('.js')).sort()
  const plugins = []
  for (const name of files) {
    const definition = (await import(pathToFileURL(path.join(directory, name)).href)).default
    if (
      !definition ||
      !RUNTIME_CATEGORIES.has(definition.category) ||
      EDITING_ONLY.has(definition.name) ||
      disabled.has(definition.name)
    )
      continue
    plugins.push({
      file: `plugins/builtin/${name}`,
      name: definition.name,
      category: definition.category,
      provides: definition.provides ?? [],
      requires: definition.requires ?? []
    })
  }
  return game.plugins?.only ? onlyWithRequirements(plugins, game.plugins.only) : plugins
}

/** The named plugins and, repeatedly, the plugins that provide what a kept one requires. */
function onlyWithRequirements(plugins, only) {
  const names = new Set(only)
  const unknown = only.filter(name => !plugins.some(plugin => plugin.name === name))
  if (unknown.length) throw new Error(`game.json plugins.only names no runtime plugin: ${unknown.join(', ')}`)
  const kept = new Set(plugins.filter(plugin => names.has(plugin.name)))
  const needed = [...kept].flatMap(plugin => plugin.requires)
  while (needed.length) {
    const key = needed.pop()
    const provider = plugins.find(plugin => plugin.provides.includes(key))
    if (!provider || kept.has(provider)) continue
    kept.add(provider)
    needed.push(...provider.requires)
  }
  return plugins.filter(plugin => kept.has(plugin))
}

/** The text `engine/player-plugins.js` is built with: each bundled plugin as a lazy import the player awaits in order. */
const playerModule = plugins =>
  `export const builtinPlugins = {\n${plugins.map(plugin => `  ${JSON.stringify(plugin.file)}: () => import(${JSON.stringify('/' + plugin.file)})`).join(',\n')}\n}\n`

/** Refuse an output folder that holds anything but an earlier export, since the build empties it. */
async function checkOutput(out, project, checkout) {
  const resolved = path.resolve(out)
  const insideProject = !path.relative(path.resolve(project), resolved).startsWith('..')
  if (insideProject || resolved === path.resolve(checkout))
    throw new Error(`refusing to export into ${resolved}: choose a folder outside the project and the checkout`)
  const entries = await fs.readdir(resolved).catch(() => [])
  if (entries.length && !entries.includes(MARK))
    throw new Error(
      `refusing to empty ${resolved}: it holds files and no earlier export. Pass --out with an empty or new folder`
    )
}

/** Copy the game's runtime files under `out/project/`. Answers their paths. */
async function copyProject(project, out) {
  const files = (await walk(project)).filter(isRuntimeFile).sort()
  for (const file of files) {
    const target = path.join(out, 'project', file)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.copyFile(path.join(project, file), target)
  }
  return files
}

/** Every file under a folder, and their total size in bytes. */
async function sizeOf(directory) {
  const entries = await fs.readdir(directory, { recursive: true, withFileTypes: true })
  const sizes = await Promise.all(
    entries
      .filter(entry => entry.isFile())
      .map(entry => fs.stat(path.join(entry.parentPath, entry.name)).then(stat => stat.size))
  )
  return { files: sizes.length, bytes: sizes.reduce((total, size) => total + size, 0) }
}

/**
 * Build one project into `out`. Answers `{ out, title, plugins, projectFiles,
 * files, bytes }`: the folder, the game's title, the plugins bundled, and how
 * much was written.
 */
export async function exportGame({ checkout, project, out }) {
  const game = JSON.parse(await fs.readFile(path.join(project, 'game.json'), 'utf8').catch(() => '{}'))
  await checkOutput(out, project, checkout)
  const plugins = await runtimePlugins(checkout, game)

  await build({
    root: checkout,
    base: './',
    configFile: false,
    logLevel: 'warn',
    plugins: [
      {
        name: 'engine-player-plugins',
        load: id =>
          path.resolve(id) === path.join(checkout, 'engine/player-plugins.js') ? playerModule(plugins) : null
      }
    ],
    build: {
      outDir: path.resolve(out),
      emptyOutDir: true,
      target: 'esnext',
      chunkSizeWarningLimit: 4096,
      rollupOptions: { input: path.join(checkout, 'player.html'), external: [/^node:/] }
    }
  })
  await fs.rename(path.join(out, 'player.html'), path.join(out, 'index.html'))

  const projectFiles = await copyProject(project, out)
  const index = await buildIndex(project, checkout, { write: false })
  await fs.writeFile(path.join(out, 'project-index.json'), JSON.stringify(index))
  await fs.writeFile(
    path.join(out, 'project-tree.json'),
    JSON.stringify(projectFiles.map(file => ({ path: file, kind: KIND(file) })))
  )
  await fs.writeFile(path.join(out, MARK), `${game.title ?? path.basename(project)}\n`)
  await writeWebApp(out, game)

  return {
    out: path.resolve(out),
    title: game.title ?? path.basename(project),
    plugins: plugins.map(plugin => plugin.name),
    projectFiles: projectFiles.length,
    ...(await sizeOf(out))
  }
}
