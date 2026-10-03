/**
 * Player boot: an exported game, with no editor.
 *
 * The same `startWorld` the editor and headless boot run, handed a file source
 * that reads the files copied beside this page, only the plugins the export
 * chose, and a screen that is one canvas with the overlay over it. Nothing
 * here writes: a built game has no project to save to.
 *
 * `export-game.mjs` writes what this reads: `project/` (the game's files),
 * `project-index.json` and `project-tree.json` beside the page, and the text of
 * `player-plugins.js`, the list of plugins it bundled.
 */
import { builtinPlugins } from './player-plugins.js'
import { makeFiles } from './files.js'
import { importPlugin } from './plugin-import.js'
import { makeRegions } from './shell-regions.js'
import { makeRenderer } from './render.js'
import { startWorld } from './start-world.js'

/** The project folder beside this page, as an absolute URL, so the game plays from any path. */
const PROJECT_BASE = new URL('project/', document.baseURI).href
globalThis.__engineProjectBase = PROJECT_BASE

/** A project plugin: one `.js` file directly in its `plugins/`. */
const PROJECT_PLUGIN = /^plugins\/[^/]+\.js$/

const fetchJson = async url => {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${response.status} ${url}`)
  return response.json()
}

/** Refuse what only an editor does, and say so. */
const refuse = what => async () => {
  throw new Error(`a built game does not ${what}`)
}

/**
 * The files an exported game reads: the copied project over plain HTTP. Every
 * write is refused, so a game that tries one says so instead of losing it.
 *
 * @returns {import('./files.js').FileTransport}
 */
function overStaticFiles() {
  return {
    index: () => fetchJson(new URL('project-index.json', document.baseURI)),
    tree: () => fetchJson(new URL('project-tree.json', document.baseURI)),
    read: async path => {
      const response = await fetch(PROJECT_BASE + path)
      if (!response.ok) throw new Error(`${response.status} ${path}`)
      return response.text()
    },
    agentPlugins: async () => [],
    agentInterface: async () => null,
    readAgent: refuse('read agent files'),
    sourceCatalog: refuse('read engine sources'),
    listDocuments: async () => [],
    readDocument: refuse('read system documents'),
    writeDocument: refuse('write system documents'),
    readSource: refuse('read engine sources'),
    writeSource: refuse('write engine sources'),
    write: refuse('write its project files'),
    writeAgent: refuse('write agent files')
  }
}

/** The export's builtin plugins, then the game's own, imported from the copied project. */
async function findPlugins(loader) {
  const found = []
  for (const [file, load] of Object.entries(builtinPlugins)) {
    const definition = await importPlugin({ file, load, loader, builtin: true })
    if (definition) found.push({ definition, builtin: true })
  }
  const listing = await overStaticFiles().tree()
  for (const file of listing
    .map(entry => entry.path)
    .filter(path => PROJECT_PLUGIN.test(path))
    .sort()) {
    const definition = await importPlugin({
      file: `project/${file}`,
      load: () => importFromProject(file),
      loader
    })
    if (definition) found.push({ definition, builtin: false })
  }
  return found
}

/** One module from the copied project, by its path from the project. By URL, since it is not bundled. */
const importFromProject = file => import(/* @vite-ignore */ PROJECT_BASE + file)

const importProjectFile = async file => (await importFromProject(file)).default || {}

/**
 * The game's screen: the canvas and the overlay over it, the same element ids
 * the editor's viewport has, so every plugin that draws finds what it expects.
 * The viewport keeps the game's declared shape and is centred in the window.
 */
function mountScreen(root, device) {
  root.innerHTML =
    '<div class="viewport" id="viewport"><canvas id="gl"></canvas><div class="viewport-ui" id="viewport-ui"></div></div>'
  const viewport = root.querySelector('#viewport')
  viewport.dataset.fit = device.fit
  viewport.style.aspectRatio = device.fit === 'screen' ? 'auto' : `${device.width} / ${device.height}`
  const overlay = root.querySelector('#viewport-ui')
  return { root, viewport, overlay, canvas: root.querySelector('#gl'), regions: makeRegions({ overlay }) }
}

/**
 * Wait for a click or key before play starts. A browser only lets a page make
 * sound after the player acts, and the click also gives the page the keyboard.
 */
function waitForStart(root, title) {
  const cover = document.createElement('button')
  cover.className = 'player-start'
  cover.type = 'button'
  cover.textContent = `${title} — click or press a key to play`
  root.append(cover)
  cover.focus()
  return new Promise(resolve => {
    const start = () => {
      cover.remove()
      removeEventListener('keydown', start)
      resolve()
    }
    cover.addEventListener('click', start)
    addEventListener('keydown', start)
  })
}

async function play() {
  const root = document.getElementById('app')
  const { context, engine, editor, loop } = await startWorld({
    openFiles: bus => makeFiles(bus, overStaticFiles()),
    loadPlugins: findPlugins,
    importProjectFile,
    async attachScreen(worldContext) {
      const game = JSON.parse(await worldContext.files.read('game.json'))
      const screen = mountScreen(root, worldContext.device)
      worldContext.ui = { mount: screen.regions.mount, unmount: screen.regions.unmount, regions: screen.regions.names }
      worldContext.shell = {
        root: screen.root,
        canvas: screen.canvas,
        viewport: screen.viewport,
        overlay: screen.overlay,
        draw() {},
        focus: () => true,
        focused: true
      }
      worldContext.renderer = await makeRenderer(screen.canvas, worldContext.view, worldContext.viewport, {
        bus: worldContext.bus,
        backend: game.render?.backend === 'webgl' ? 'webgl' : 'webgpu'
      })
      worldContext.renderer.setPixelRatio(worldContext.device.pixelRatio)
      worldContext.renderer.resize()
    }
  })
  window.engine = engine
  document.title = editor.projectName
  addEventListener('resize', () => context.renderer.resize())
  editor.screenReady()

  // Until the player starts, draw the level as it opens, so the page is not black.
  let isWaiting = true
  const paint = () => {
    if (!isWaiting) return
    context.renderer.draw(context.world)
    requestAnimationFrame(paint)
  }
  paint()
  await waitForStart(root, editor.projectName || 'Game')
  isWaiting = false
  // Reload recovery may already have started play; toggling would stop it.
  if (!loop.running) editor.togglePlay()
}

play().catch(error => {
  document.getElementById('app').innerHTML =
    `<pre class="player-error">The game could not start.\n\n${error.stack || error}</pre>`
  console.error(error)
})
