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
import { PROJECT_PREFIX } from './asset-path.js'
import { makeFiles, overHTTP } from './files.js'
import { importPlugin, reportImportFailure } from './plugin-import.js'
import { makeRenderer } from './render.js'
import { makeShell } from './shell.js'
import { startWorld } from './start-world.js'

/**
 * What the server says it is serving. Where the project is on disk never
 * reaches the page.
 *
 * Asked for rather than baked in: the server can repoint itself at another
 * project, and a name fixed at start-up would be the one it left.
 *
 * `untitled` decides whether an edit is written. A built page with no dev
 * server has no project to save to, so it reads as named and nothing changes.
 */
async function openProject() {
  await globalThis.__engineRoleReady
  try {
    const body = await (await fetch('/api/project')).json()
    if (typeof body.project === 'string') return { name: body.project, untitled: body.untitled === true }
  } catch {
    /* no dev server: the built page carries no name */
  }
  return { name: PROJECT_PREFIX, untitled: false }
}

let fileVersion = 0

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
const importProjectFile = async file =>
  (await import(/* @vite-ignore */ `/${PROJECT_PREFIX}/${file}?hot=${++fileVersion}`)).default || {}

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
 *
 * Importing a file and saying what went wrong when it will not import is the
 * one half both finders share, so it lives in `plugin-import.js` and this one
 * only decides which files to offer it. The loader is the argument that makes
 * that possible: a file that throws has no plugin name, so the loader is the
 * only thing that can answer for it when a command turns up missing later.
 */
async function findPlugins(loader) {
  const found = []

  for (const [path, load] of Object.entries(import.meta.glob('/plugins/builtin/*.js'))) {
    const definition = await importPlugin({ file: path.replace(/^\//, ''), load, loader, builtin: true })
    if (definition) found.push({ definition, builtin: true })
  }

  let listing = []
  try {
    listing = await overHTTP().tree()
  } catch (e) {
    // A project whose file list cannot be read has no plugins as far as this is
    // concerned, and an editor quietly missing eight of them is the worst way to
    // find that out.
    reportImportFailure(loader, `${PROJECT_PREFIX}/plugins/`, e)
  }

  for (const file of listing
    .map(entry => entry.path)
    .filter(f => PROJECT_PLUGIN.test(f))
    .sort()) {
    const definition = await importPlugin({
      file: `${PROJECT_PREFIX}/${file}`,
      load: () => import(/* @vite-ignore */ `/${PROJECT_PREFIX}/${file}`),
      loader
    })
    if (definition) found.push({ definition, builtin: false })
  }

  return found
}

/**
 * Start the world, then the screen: the shell, the renderer, and the edit-mode
 * paint loop.
 *
 * The shell must exist before the renderer because it builds the canvas, so
 * both are put on `context` in `attachScreen` rather than returned. A failure
 * here replaces the page with the stack trace, because a half-built editor is
 * worse to read than a stopped one.
 */
async function boot() {
  const root = document.getElementById('app')

  // Say which project and which server this tab is, where a person looks
  // first. Several editors can be open at once, on several ports, and two tabs
  // naming only the project are told apart by nothing.
  const open = await openProject()
  document.title = `${open.name} :${location.port} — engine`

  const { context, engine, world, loop } = await startWorld({
    openFiles: bus => makeFiles(bus),
    loadPlugins: findPlugins,
    importProjectFile,
    projectDirectory: PROJECT_PREFIX,
    projectName: open.name,
    projectUntitled: open.untitled,

    // The shell builds the canvas the renderer draws into, so the shell comes
    // first and context.renderer is filled in immediately after. Both are put
    // on context rather than returned, because a world without a screen has
    // neither and every reader already treats them as optional.
    async attachScreen(worldContext) {
      const shell = makeShell(root, worldContext)
      worldContext.shell = shell

      // The renderer is handed the session's view and viewport rather than
      // owning them, so game code reaches the camera as context.view whether
      // anything is drawing or not. `context` is the outer const this call is
      // still assigning, so the world's own object is the one to write.
      const renderer = await makeRenderer(shell.canvas, worldContext.view, worldContext.viewport)
      worldContext.renderer = renderer
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
  // `frame:painted` is the edit-mode counterpart of a `frame` system, which
  // only runs while the loop does. A plugin that has to touch what was drawn —
  // and a model finishes loading long after the entity using it — has no other
  // hook while the world is stopped.
  /**
   * Draw one edit-mode frame: sync, draw, then announce it.
   *
   * `frame:painted` is the stopped-world counterpart of a frame system, which
   * runs only while the loop does. A model that finishes loading after the
   * frame that asked for it has no other hook to redraw on.
   */
  const paint = () => {
    if (loop.running) return
    context.renderer.draw(world)
    context.bus.emit('frame:painted')
  }
  /**
   * Whether this page still draws.
   *
   * A page whose dev server is gone cannot reload, be edited or be read, so it
   * stops drawing and gives the graphics card back what it holds. A heavy scene
   * left drawing in a forgotten tab costs hundreds of megabytes for nothing.
   */
  let alive = true

  /** Keep asking for the next frame while the world is stopped. */
  const idle = () => {
    if (!alive) return
    paint()
    requestAnimationFrame(idle)
  }
  idle()
  const hiddenPaint = setInterval(() => {
    if (alive && document.hidden) paint()
  }, 100)

  if (import.meta.hot) {
    import.meta.hot.on('vite:ws:disconnect', () => {
      if (!alive) return
      alive = false
      clearInterval(hiddenPaint)
      loop.stop()
      context.renderer.release()
      document.getElementById('app').innerHTML =
        '<pre style="padding:24px;font:12px ui-monospace">the dev server is gone. ' +
        'this page stopped drawing and gave back what it held. ' +
        'start the server and reload to carry on.</pre>'
    })
  }

  console.log('%cengine ready', 'font-weight:600', '— try engine.snapshot() or engine.commands()')
}

boot().catch(e => {
  document.getElementById('app').innerHTML =
    `<pre style="padding:24px;font:12px ui-monospace">boot failed\n\n${e.stack || e}</pre>`
  console.error(e)
})
