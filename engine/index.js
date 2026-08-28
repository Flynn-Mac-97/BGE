/**
 * Editor boot — the browser half.
 *
 * Everything that does not need a document lives in `start-world.js`. What is
 * left here is the screen: find the plugin files with a Vite glob, import
 * project files by URL, mount the shell, build the renderer, and keep painting
 * while nothing is playing.
 *
 * Keeping this file thin is the point. Anything added here is something a
 * headless world cannot do, and headless is how several agents work at once.
 */
import { makeFiles } from './files.js'
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
 */
let fileVersion = 0
const importProjectFile = async file =>
  (await import(/* @vite-ignore */ `/project/${file}?hot=${++fileVersion}`)).default || {}

async function findPlugins() {
  const builtin = import.meta.glob('/plugins/builtin/*.js')
  const project = import.meta.glob('/project/plugins/*.js')
  const found = []

  for (const [path, load] of Object.entries({ ...builtin, ...project })) {
    try {
      const definition = (await load()).default
      if (!definition) continue
      found.push({ definition, builtin: path in builtin })
    } catch (e) {
      console.error(`[loader] ${path} failed to import`, e)
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
