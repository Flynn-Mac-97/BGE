/**
 * Editor boot — the browser half.
 *
 * Everything that does not need a document lives in `start-world.js`. What is
 * left here is the screen: find the plugin files, import project files by URL,
 * mount the shell, build the renderer, and keep painting while nothing is
 * playing.
 *
 * Keeping this file thin is the point. Anything added here is something a
 * headless world cannot do, and headless is how several agents work at once.
 */
import { PROJECT_DIRECTORY } from './asset-path.js'
import { makeFiles, overHTTP } from './files.js'
import { makeRenderer } from './render.js'
import { makeShell } from './shell.js'
import { startWorld } from './start-world.js'

/**
 * Project files are imported by URL with a changing query, not through
 * `import.meta.glob`.
 *
 * A glob is expanded when the page is built, so a type file created after that
 * does not exist as far as the running editor is concerned — writing a new type
 * would need a reload before it could be used. The index is rebuilt by the
 * server on every write, so this path sees new files immediately.
 *
 * `@vite-ignore` is also what lets the project directory be a parameter: Vite
 * passes a runtime-built specifier straight through instead of resolving it at
 * build time.
 */
let fileVersion = 0
const importProjectFile = async file =>
  (await import(/* @vite-ignore */ `/${PROJECT_DIRECTORY}/${file}?hot=${++fileVersion}`)).default || {}

/** A plugin the project supplies: one `.js` file directly in its `plugins/`. */
const PROJECT_PLUGIN = /^plugins\/[^/]+\.js$/

/**
 * Every plugin file. Engine plugins are globbed; the project's are listed.
 *
 * The engine's own glob stays a static literal because those files are engine
 * source that a production build has to bundle, and their path is not
 * project-relative. The project's plugins cannot be globbed once the project
 * directory is a parameter — Vite's import-glob plugin checks its argument is a
 * literal and throws on anything else — so they are read from the project tree
 * and imported by URL, exactly the way every type, behaviour and test in the
 * project is already imported. That also makes this the twin of the headless
 * runner, which has always read the directory rather than globbing it: a plugin
 * written a second ago is found on the next load, either side of the split.
 */
async function findPlugins() {
  const found = []

  for (const [path, load] of Object.entries(import.meta.glob('/plugins/builtin/*.js'))) {
    try {
      const definition = (await load()).default
      if (!definition) continue
      found.push({ definition, builtin: true })
    } catch (e) {
      console.error(`[loader] ${path} failed to import`, e)
    }
  }

  let listing = []
  try {
    listing = await overHTTP().tree()
  } catch (e) {
    // A project whose file list cannot be read has no plugins as far as this is
    // concerned, and an editor quietly missing eight of them is the worst way to
    // find that out.
    console.error(`[loader] could not list ${PROJECT_DIRECTORY}/ — no project plugins were loaded`, e)
  }

  for (const file of listing.map(entry => entry.path).filter(f => PROJECT_PLUGIN.test(f)).sort()) {
    try {
      const definition = (await import(/* @vite-ignore */ `/${PROJECT_DIRECTORY}/${file}`)).default
      if (!definition) continue
      found.push({ definition, builtin: false })
    } catch (e) {
      console.error(`[loader] ${PROJECT_DIRECTORY}/${file} failed to import`, e)
    }
  }

  return found
}

async function boot() {
  const root = document.getElementById('app')

  const { context, engine, world, loop } = await startWorld({
    openFiles: bus => makeFiles(bus),
    loadPlugins: findPlugins,
    importProjectFile,

    // The shell builds the canvas the renderer draws into, so the shell comes
    // first and context.renderer is filled in immediately after. Both are put
    // on context rather than returned, because a world without a screen has
    // neither and every reader already treats them as optional.
    async attachScreen(context) {
      const shell = makeShell(root, context)
      context.shell = shell

      // The renderer is handed the session's view and viewport rather than
      // owning them, so game code reaches the camera as context.view whether
      // anything is drawing or not.
      const renderer = makeRenderer(shell.canvas, context.view, context.viewport)
      context.renderer = renderer
      renderer.resize()
    }
  })

  window.engine = engine

  context.bus.on('open:file', () => context.shell.draw())
  context.shell.draw()

  // plugins that need DOM (viewport tools) wait for this rather than onLoad
  context.bus.emit('shell:ready', context)

  // Edit mode still needs to draw, just without stepping the simulation.
  // Falls back to a timer when the tab is hidden so a headless agent still
  // gets a rendered canvas to screenshot.
  const paint = () => { if (!loop.running) { context.renderer.sync(world); context.renderer.draw() } }
  const idle = () => { paint(); requestAnimationFrame(idle) }
  idle()
  setInterval(() => { if (document.hidden) paint() }, 100)

  console.log('%cengine ready', 'font-weight:600', '— try engine.snapshot() or engine.commands()')
}

boot().catch(e => {
  document.getElementById('app').innerHTML =
    `<pre style="padding:24px;font:12px ui-monospace">boot failed\n\n${e.stack || e}</pre>`
  console.error(e)
})
