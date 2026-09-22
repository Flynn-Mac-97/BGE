/**
 * Kernel: start a world, with or without a screen.
 *
 * This is the whole engine minus everything that needs a document. It builds
 * the bus, the world, the loop, the plugin loader and the deterministic
 * context, loads the project, and returns the same surface the browser hands
 * out as `window.engine`.
 *
 * It keeps the boot order; each thing it builds has its own module beside it.
 * The device profile, the plugin start gate, the editor, the frame wiring, the
 * plugin boot, the context surface and the project's levels all live in their
 * own file, so a reader of this one sees the order and nothing else.
 *
 * Splitting it out is what lets many agents work at once. A world in node needs
 * no port, no dev server and no browser tab, so ten of them run side by side
 * without sharing one mutable thing. The editor is then a thin wrapper that
 * adds a shell, a renderer and the panels.
 *
 * There is one code path. Headless is not a reduced copy of the engine — it is
 * the same engine with nothing drawing it. The moment it becomes a second
 * implementation, the two start to disagree and neither can be trusted.
 */
import { carryWorldThroughReload, takeReloadNote } from './reload-notice.js'
import { makeBus } from './bus.js'
import { makeWorld } from './world.js'
import { makeLoop } from './loop.js'
import { makeLoader } from './loader.js'
import { makeInspect, makeLog } from './inspect.js'
import { PROJECT_PREFIX } from './asset-path.js'
import { captureMoment, makeCheckpoints, restoreMoment } from './checkpoint.js'
import { makeRewind, watchWorldChanges } from './rewind.js'
import { readDevice } from './device-profile.js'
import { makeStartup } from './plugin-startup.js'
import { makeEditor } from './world-editor.js'
import { makeFrameWiring } from './frame-wiring.js'
import { attachWorldSurface } from './world-context.js'
import { bootPlugins } from './plugin-boot.js'
import { loadLevel, loadTypes, reloadBehaviour, reloadType, saveLevel, togglePlay } from './world-project.js'

/**
 * Where the camera is looking. Session state, not renderer state.
 *
 * It used to live inside the renderer, which meant game code could only reach
 * it through `context.renderer.view` — and a world with nothing rendering it
 * had no camera at all. It is a game value, so it lives with the game.
 */
const DEFAULT_VIEW = {
  x: 7, y: 3, z: 0, zoom: 48, mode: 'ortho',
  // Where a perspective camera is pointed. Radians, Y-up, rotation order YXZ:
  // yaw turns left around +Y, pitch looks up around +X, and 0/0 faces -Z.
  // They sit here rather than in the renderer for the same reason x and y do —
  // a first-person camera plugin writes them whether or not anything is drawing.
  yaw: 0, pitch: 0, fov: 90
}

/**
 * @desc Build one world and return its surface: context, engine, world, loop,
 *   loader, bus, files, editor, view, viewport and device.
 * @domain world boot — the whole engine minus anything that needs a document.
 * @effects Builds the bus, world, loop, loader and file transport; reads
 *   `game.json`; registers the project's behaviours and types; boots the
 *   enabled plugins; mounts the screen; loads the start level; emits
 *   `world:changed`, `level:loaded`, `selection:changed`, `tool:changed`,
 *   `plugins:changed` and the play events; and may restore a world carried
 *   through a page reload.
 *
 * The two halves differ only in what they pass in — a file transport, a plugin
 * finder, an importer, and a screen — so the same boot runs in a browser tab
 * and in node with nothing drawing it.
 *
 * @param {object} [options]
 * @param {Function} options.openFiles `(bus) =>` the file reader and writer. A
 *   factory rather than a ready-made object because files announce their writes
 *   on the bus, and the bus is created here — passing one in would mean two of
 *   them.
 * @param {Function} options.loadPlugins `async () => [{ definition, builtin }]`
 *   — a glob in the browser, readdir in node.
 * @param {Function} options.importProjectFile `async (file) =>` the module's
 *   default export, for types, behaviours and tests.
 * @param {string} [options.projectDirectory] Which directory under the checkout
 *   holds the project. The constant `project`, not the directory on disk. It is
 *   the one name a project file is known by in both halves — a URL, a match
 *   pattern, a claim — and the dev server maps it onto whatever directory it
 *   serves.
 * @param {string} [options.projectName] What the editor shows. `game.json`'s
 *   title overrides it.
 * @param {boolean} [options.projectUntitled] Whether the open project is the
 *   untitled one. An untitled project is a scratch space: edits are held here
 *   and never written, so reloading the page drops them and nothing has to be
 *   undone. `project.saveAs` writes them out at the moment the project gets a
 *   name.
 * @param {object} [options.host] What a plugin can only do in node: the
 *   project's real directory, and running a program. `null` in the browser, and
 *   a plugin that needs an outside tool reads that as "answer with the terminal
 *   command instead".
 * @param {Function} [options.attachScreen] The browser mounts its shell and
 *   renderer here. Headless does nothing.
 * @param {object} [options.viewport] A measured screen. Overrides the game's
 *   declared device when given.
 * @param {object} [options.view] The starting camera, copied from `DEFAULT_VIEW`.
 * @returns {Promise<object>} The world's surface: `context`, `engine`, `world`,
 *   `loop`, `loader`, `bus`, `files`, `editor`, `view`, `viewport` and
 *   `device`.
 */
export async function startWorld({
  openFiles,
  loadPlugins,
  importProjectFile,
  projectDirectory = PROJECT_PREFIX,
  projectName: openProjectName = PROJECT_PREFIX,
  projectUntitled = false,
  host = null,
  attachScreen = async () => {},
  viewport: measuredViewport = null,
  view = { ...DEFAULT_VIEW }
} = {}) {
  const bus = makeBus()
  // Made before the plugins load, so errors raised while the world is built
  // reach `snapshot().errors`.
  const log = makeLog(bus)
  const world = makeWorld(bus)
  const loader = makeLoader(bus)
  const files = openFiles(bus)

  // Read before anything is built: game.json names the screen the game is drawn
  // for, which sets the viewport, and the plugins that are off, which must be
  // off before any of them boots.
  let game = {}
  try { game = JSON.parse(await files.read('game.json')) } catch { /* optional */ }
  const device = readDevice(game)
  const viewport = measuredViewport || { width: device.width, height: device.height }

  const editor = makeEditor({ projectDirectory, projectName: openProjectName, projectUntitled, bus })

  const context = {}
  // Made before the plugins load, because a plugin declares its own start-up
  // work in `onLoad`.
  const startup = makeStartup(bus)
  // The same, for what a plugin holds rather than for what it is fetching: a
  // checkpoint asks every plugin by name for its own state.
  const checkpoints = makeCheckpoints(bus)
  Object.assign(context, { world, files, bus, loader, editor, view, viewport, device, host, startup, checkpoints })
  editor.context = context
  // world.destroy runs onDestroy and needs a context to hand it. Without this the
  // hook received undefined, which nothing noticed because most onDestroy
  // hooks only touch the entity.
  world.context = context

  // The loop and the rewind both reach the world through `context`, so each hook
  // reads what it needs at the moment it runs rather than closing over a local
  // that may not exist yet.
  const loop = makeLoop(makeFrameWiring({ world, loader, context }))
  context.loop = loop

  // A whole moment of the run: the entities, the clock, the random stream, the
  // input record, and whatever a plugin holds of its own. On `context` rather
  // than on `engine`, because it belongs to the world rather than to the
  // reading surface, and a plugin that wants to mark a moment uses it.
  Object.assign(context, {
    /**
     * @desc Take a moment of this world, to come back to.
     * @domain checkpoint — a whole moment of a run.
     * @effects Reads the world, the loop and every plugin that registered state.
     * @returns {object} The moment. In memory, not JSON: a solver's bytes do not
     *   belong in a string.
     */
    capture: () => captureMoment({ world, loop, checkpoints }),
    /**
     * @desc Put this world back to a moment.
     * @domain checkpoint — a whole moment of a run.
     * @effects Restores each registered plugin, then the entities, then the
     *   clock, the stream and the input record; emits `world:changed` through
     *   `world.restore`.
     * @param {object} moment From `capture`.
     * @returns {object} What came back, what refused, and what the moment could
     *   not carry.
     * @throws When the moment was taken by a different version of the engine.
     */
    restore: moment => restoreMoment(moment, { world, loop, checkpoints })
  })

  // The way back through a run: the last two minutes of it, kept as moments, and
  // the walk from one to a step count. On `context` for the same reason a
  // checkpoint is, and wired here because it needs both the loop and the
  // plugin registry.
  const rewind = makeRewind({ world, loop, checkpoints, bus })
  context.rewind = rewind
  // A level load and a restored page both replace every entity, so the marks of
  // the world before them are moments of a world that is gone.
  watchWorldChanges(rewind, bus)

  // ---------------------------------------------------------------- project

  /**
   * The level file exactly as it was read, and the one the next save writes back.
   *
   * A holder rather than a closed-over local: `loadLevel` and `saveLevel` are
   * module functions now, and they have to agree on which file is open.
   */
  const levelFile = { raw: {} }

  /**
   * What the project and level work needs.
   *
   * These were closures over the locals above. As module functions they take
   * what they read and write in one object, named once, here.
   */
  const parts = { world, loop, bus, editor, view, files, importProjectFile, context, levelFile }
  editor.saveLevel = options => saveLevel(parts, options)
  editor.loadLevel = name => loadLevel(parts, name)
  editor.loadTypes = () => loadTypes(parts)
  editor.reloadType = name => reloadType(parts, name)
  editor.reloadBehaviour = name => reloadBehaviour(parts, name)
  editor.togglePlay = () => togglePlay(parts)

  attachWorldSurface(context, { world, bus, editor, loop, importProjectFile, saveLevel: editor.saveLevel })

  // ---------------------------------------------------------------- run
  await bootPlugins({ loader, loadPlugins, game, context })

  // Started here and awaited at the end, so the wait runs alongside the index,
  // the types and the level rather than after them.
  const starting = startup.settled()

  // The screen, if there is one. Between booting the plugins and loading the
  // project, because a panel must exist before the first level:loaded fires.
  await attachScreen(context)

  editor.index = await files.index()
  await loadTypes(parts)

  // game.json says which level opens. Falling back to "whichever sorts first"
  // means adding a level can silently change which one you land in — and the
  // first thing you would do is edit the wrong file.
  const levels = Object.keys(editor.index.levels)
  editor.game = game
  editor.projectName = game.title || editor.projectName

  const start = levels.includes(game.startLevel) ? game.startLevel : levels[0]
  if (game.startLevel && start !== game.startLevel) {
    console.error(`[project] game.json startLevel "${game.startLevel}" does not exist — opening "${start}"`)
  }
  if (start) await loadLevel(parts, start)

  // A world is handed out ready to be stepped. A plugin that has to fetch
  // something declares it in `onLoad`, and a caller that stepped before it
  // landed would simulate a world with a backend missing from it — the same
  // level at the same step count, two different answers. Anything still
  // starting is named here, and the loop holds the world for it, so a run that
  // cannot be exact says so rather than answering anyway.
  const started = await starting
  if (started.pending.length) {
    console.error(`[startup] still starting when the world opened: ${started.pending.join(', ')}. ` +
      'A step taken now runs without it, and the loop holds the world until it lands.')
  }

  // `reload` reports that the page reloaded and the world was rebuilt. It is a
  // function because it answers once, then answers nothing.
  const engine = makeInspect({ world, loader, loop, files, bus, editor, view, log, reload: takeReloadNote, rewind })
  context.engine = engine

  // Editing engine or plugin source is a full page reload, and a page reload
  // takes the world with it. Put the moment back where the last page left one,
  // and say what happened either way — a rebuilt world nobody announced is a
  // world an agent will go on debugging as though it were the old one. Nothing
  // here costs a headless world anything: there is no session to restore from.
  await carryWorldThroughReload({ world, loop, editor, view, bus, context, engine })

  return { context, engine, world, loop, loader, bus, files, editor, view, viewport, device }
}
