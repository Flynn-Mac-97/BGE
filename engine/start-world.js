/**
 * Kernel: start a world, with or without a screen.
 *
 * This is the whole engine minus everything that needs a document. It builds
 * the bus, the world, the loop, the plugin loader and the deterministic
 * context, loads the project, and returns the same surface the browser hands
 * out as `window.engine`.
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
import { makeProjector } from './camera-project.js'
import { captureMoment, makeCheckpoints, restoreMoment } from './checkpoint.js'
import { makeRewind, watchWorldChanges } from './rewind.js'

/**
 * The screen a game is drawn for, when the game declares none.
 *
 * The camera clamps to level bounds using the viewport size, so without a fixed
 * default the same level would frame differently in a small window than in a
 * large one — and a headless run would disagree with both. Declaring it means a
 * camera position is reproducible, which is the whole promise of `simulate()`.
 */
const DEFAULT_DEVICE = { width: 1280, height: 720, pixelRatio: 1, orientation: 'landscape' }

/**
 * @desc A declared number only when it is finite and positive, else null.
 * @domain device — the screen shape a game declares.
 * @pure Reads its argument and returns a value.
 * @param {number} value The number a game declared.
 * @returns {number|null} The number, or null when it cannot be used.
 */
const positive = value => (Number.isFinite(value) && value > 0 ? value : null)

/**
 * @desc Three decimal places, so a saved place matches what a reader saw.
 * @domain level — a camera position written back to a level file.
 * @pure Reads its argument and returns a value.
 * @param {number} n The number to round.
 * @returns {number} The number at three decimal places.
 */
const round = n => Math.round(n * 1000) / 1000

/**
 * @desc The target device a game declares under `device` in game.json, filled in
 * from the default.
 * @domain device — the screen shape a game declares.
 * @pure Reads its argument and returns a new device object.
 *
 * One declaration, read by everything that needs a screen shape: the viewport
 * every camera clamps against, and the size `see.capture` draws at. A game that
 * declares a shape nothing reads gets art measured at the wrong shape.
 *
 * @param {object} game The parsed `game.json`, or an empty object.
 * @returns {object} `width`, `height`, `pixelRatio` and `orientation`.
 */
function readDevice(game) {
  const declared = game?.device || {}
  const width = positive(declared.width) ?? DEFAULT_DEVICE.width
  const height = positive(declared.height) ?? DEFAULT_DEVICE.height
  return {
    width,
    height,
    pixelRatio: positive(declared.pixelRatio) ?? DEFAULT_DEVICE.pixelRatio,
    orientation: declared.orientation || (height > width ? 'portrait' : 'landscape')
  }
}

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
 * Wall milliseconds a plugin's declared start-up work may take before the world
 * is handed over without it.
 *
 * A bound rather than a promise that may never settle: one plugin that hangs
 * must not stop a world from starting. What is still pending is named, and the
 * loop holds the world for it, so a run that cannot be exact says so instead of
 * answering anyway.
 */
const STARTUP_TIMEOUT = 10_000

/**
 * Work a plugin started that has not finished, by name.
 *
 * A plugin cannot finish synchronously what it has to fetch. Rapier compiles two
 * megabytes of WebAssembly, and before this existed the first step ran while it
 * was still loading — so a simulation advanced a world with no physics in it and
 * answered as though it had, and the same level at the same step count produced
 * two different worlds.
 *
 * A plugin calls `add` in `onLoad`, and the world is not handed to a caller who
 * can step it until that promise settles.
 *
 * @param {object} bus The bus a failed start is announced on.
 * @returns {object} `add(name, promise)`, `pending`, and `settled(timeoutMs)`.
 */
function makeStartup(bus) {
  const starts = new Map()
  const finished = new Set()

  const report = (name, error) => {
    const why = `${name} failed to start — ${error?.message || error}`
    console.error(`[startup] ${why}`)
    bus.emit('plugin:error', { name, error: why })
  }

  return {
    /**
     * Declare one plugin's start-up work.
     *
     * The first promise for a name wins. A module behind a plugin is shared
     * while `onLoad` runs once per world, so a second world must not start a
     * second load, and the wait must not follow the later one.
     */
    add(name, promise) {
      if (starts.has(name)) return starts.get(name)
      // Caught here so a failed start cannot arrive as an unhandled rejection,
      // and so the failure is reported by the name the reader knows.
      const settled = Promise.resolve(promise).then(
        () => { finished.add(name) },
        error => { finished.add(name); report(name, error) })
      starts.set(name, settled)
      return settled
    },

    /** The names still starting. Empty means the world is ready to step. */
    get pending() { return [...starts.keys()].filter(name => !finished.has(name)) },

    /**
     * Wait for every declared start, bounded.
     *
     * @param {number} [timeoutMs] How long to wait before giving up.
     * @returns {Promise<object>} `ready` and `pending`, both lists of names.
     */
    async settled(timeoutMs = STARTUP_TIMEOUT) {
      const names = [...starts.keys()]
      if (!names.length) return { ready: [], pending: [] }
      let timer = 0
      const expired = new Promise(resolve => { timer = setTimeout(resolve, timeoutMs); timer.unref?.() })
      await Promise.race([Promise.all([...starts.values()]), expired])
      clearTimeout(timer)
      return {
        ready: names.filter(name => finished.has(name)),
        pending: names.filter(name => !finished.has(name))
      }
    }
  }
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

  const editor = {
    // The name a file is known by, and the name a person is shown. Two
    // different questions — a panel showing the title and a plugin naming
    // `project/plugins` need different answers.
    projectDirectory,
    projectName: openProjectName,
    projectUntitled,
    levelName: '—',
    selection: new Set(),
    tool: 'select',
    index: { types: {}, behaviours: {}, levels: {}, assets: {}, config: [] },
    camera: null,
    context: null,

    /**
     * @desc Replace or extend the selection with the given ids.
     * @domain editor — what the editor has selected.
     * @effects Clears and adds entries in `editor.selection`, then emits
     *   `selection:changed` with the ids.
     * @param {string|string[]|object|object[]} ids One id, or a list of ids or
     *   objects with an `id`. Falsy entries are dropped.
     * @param {boolean} [additive] Keep the current selection instead of
     *   replacing it.
     * @returns {void}
     */
    select(ids, additive = false) {
      const list = [].concat(ids ?? []).map(v => (typeof v === 'string' ? v : v?.id)).filter(Boolean)
      if (!additive) editor.selection.clear()
      for (const id of list) editor.selection.add(id)
      bus.emit('selection:changed', [...editor.selection])
    },

    /**
     * @desc Set the active editor tool and announce the change.
     * @domain editor — which tool the editor is using.
     * @effects Stores `editor.tool`, then emits `tool:changed` and
     *   `plugins:changed`.
     * @param {string} id The tool id.
     * @returns {void}
     */
    setTool(id) {
      editor.tool = id
      bus.emit('tool:changed', id)
      bus.emit('plugins:changed')
    }
  }

  const context = {}
  // Made before the plugins load, because a plugin declares its own start-up
  // work in `onLoad`.
  const startup = makeStartup(bus)
  // The same, for what a plugin holds rather than for what it is fetching: a
  // checkpoint asks every plugin by name for its own state.
  const checkpoints = makeCheckpoints(bus)
  // Assigned once the loop exists. The step hook above runs on every fixed step
  // and reads it, so it starts as nothing rather than in a temporal dead zone.
  let rewind = null
  Object.assign(context, { world, files, bus, loader, editor, view, viewport, device, host, startup, checkpoints })
  editor.context = context
  // world.destroy runs onDestroy and needs a context to hand it. Without this the
  // hook received undefined, which nothing noticed because most onDestroy
  // hooks only touch the entity.
  world.context = context

  const loop = makeLoop({
    /**
     * @desc Report a loop error without stopping the loop.
     * @domain loop — errors raised while a step runs.
     * @effects Writes the error to the console.
     * @param {Error} e The error the step threw.
     * @returns {void}
     */
    onError(e) { console.error('[timer]', e) },
    /**
     * @desc Record where every entity is before the step moves it.
     * @domain world — entity places between steps.
     * @effects Writes each entity's current place in `world`.
     * @returns {void}
     */
    onStepStart() {
      world.rememberPlaces()
      // Before the step, so the mark is the world at the count the clock reads —
      // a mark taken inside a step would be a world that has already moved and a
      // clock that says it has not.
      rewind?.observe()
    },
    /**
     * @desc Advance the world by one fixed step: fixed-time systems, then every
     * entity's update.
     * @domain world — the fixed-step simulation.
     * @effects Marks `world.simulated`, runs each enabled plugin's fixed
     * systems, runs each entity's `update` hook, and reports a failing system
     * through `loader.fail`.
     * @param {number} seconds The fixed step length in seconds.
     * @returns {void}
     */
    onFixed(seconds) {
      // One flag, set at the only place time advances, so nothing can step the
      // world without marking it — including engine.simulate().
      world.simulated = true
      for (const s of loader.schedule.fixed) {
        if (!loader.plugins.get(s.plugin)?.enabled) continue
        try { s.run(world, seconds, context) } catch (e) { loader.fail(s.plugin, e) }
      }
      // world.hook runs the attached behaviours first, then the type's own
      // update — so a type always gets the last word on what it composed.
      for (const e of [...world.entities]) world.hook(e, 'update', seconds, context)
    },
    /**
     * @desc Advance one rendered frame: frame-time systems, then draw.
     * @domain world — the frame step.
     * @effects Runs each enabled plugin's frame systems, reports a failing
     * system through `loader.fail`, and syncs and draws `context.renderer` when
     * the world has one.
     * @param {number} seconds The frame length in seconds.
     * @returns {void}
     */
    onFrame(seconds) {
      for (const s of loader.schedule.frame) {
        if (!loader.plugins.get(s.plugin)?.enabled) continue
        try { s.run(world, seconds, context) } catch (e) { loader.fail(s.plugin, e) }
      }
      // Optional on purpose: a world with no renderer runs the same systems in
      // the same order and simply draws nothing.
      context.renderer?.sync(world, loop.blend)
      context.renderer?.draw()
    }
  })
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
  rewind = makeRewind({ world, loop, checkpoints, bus })
  context.rewind = rewind
  // A level load and a restored page both replace every entity, so the marks of
  // the world before them are moments of a world that is gone.
  watchWorldChanges(rewind, bus)

  // ---------------------------------------------------------------- project
  /**
   * @desc Import every type and behaviour the index names.
   * @domain project — the types and behaviours a project declares.
   * @effects Clears and refills `world.behaviours` and `world.types`, imports
   * each project file, and logs a file that failed to import without stopping
   * the rest.
   *
   * Behaviours load first, because a type's attachment list is resolved the
   * moment the type registers; the other order reports every attachment as
   * missing on a sound project. One bad file is logged and skipped, so it
   * cannot stop the rest of the project loading.
   *
   * @returns {Promise<void>}
   */
  async function loadTypes() {
    world.behaviours.clear()
    // Behaviours load before types, because a type's attachment list is
    // resolved the moment the type registers. The other way round leaves every
    // attachment reporting "no behaviours/x.js" on a perfectly good project.
    for (const [name, behaviour] of Object.entries(editor.index.behaviours || {})) {
      try {
        world.registerBehaviour(name, await importProjectFile(behaviour.file))
      } catch (e) {
        console.error(`[behaviours] ${name} failed`, e)
      }
    }

    world.types.clear()
    for (const [name, type] of Object.entries(editor.index.types)) {
      try {
        world.registerType(name, await importProjectFile(type.file))
      } catch (e) {
        console.error(`[types] ${name} failed`, e)
      }
    }
  }

  /**
   * @desc Re-import one type and bring its live entities onto the new definition.
   * @domain project — a type file that changed.
   * @effects Re-reads `editor.index`, imports the type's file, unregisters the
   * type when it is gone or retypes its entities when it is not, and emits
   * `world:changed`.
   *
   * @param {string} name The type name.
   * @returns {Promise<object>} How many entities moved, or that the type is gone.
   * @throws Whatever the imported file did wrong.
   */
  async function reloadType(name) {
    editor.index = await files.index()
    const entry = editor.index.types[name]
    if (!entry) {
      world.unregisterType(name)
      return { name, removed: true }
    }
    const moved = world.retype(name, await importProjectFile(entry.file))
    bus.emit('world:changed')
    return { name, entities: moved }
  }

  /**
   * @desc The same, for a behaviour. Every entity that attached it moves onto
   * the new file.
   * @domain project — a behaviour file that changed.
   * @effects Re-reads `editor.index`, imports the behaviour's file, unregisters
   * the behaviour when it is gone or rebehaves its entities when it is not, and
   * emits `world:changed`.
   *
   * @param {string} name The behaviour name.
   * @returns {Promise<object>} How many entities moved, or that the behaviour is gone.
   */
  async function reloadBehaviour(name) {
    editor.index = await files.index()
    const entry = (editor.index.behaviours || {})[name]
    if (!entry) {
      world.unregisterBehaviour(name)
      return { name, removed: true }
    }
    const moved = world.rebehave(name, await importProjectFile(entry.file))
    bus.emit('world:changed')
    return { name, entities: moved }
  }

  /**
   * The level file exactly as it was read.
   *
   * A save must never narrow a file — the same rule `_extraKeys` follows for a
   * placement, applied to the level itself. `hud`, `world`, `seed` and a camera
   * rule like `follow` belong to plugins the kernel knows nothing about, and
   * writing only what the kernel models would silently delete every one of them.
   */
  let loadedLevel = {}

  /**
   * @desc Open one level: reset the clock, place every entity, and announce it.
   * @domain level — the level currently open.
   * @effects Reads the level file, stores it in `loadedLevel`, clears the world,
   * resets the loop, updates `editor.levelName` and the view, spawns every
   * entity, and emits `world:changed` and `level:loaded`.
   *
   * Ids are position-in-file rather than a counter, so `coin-2` means the same
   * coin after a reload. The raw file is kept for `saveLevel`, which must write
   * back keys the kernel does not model.
   *
   * @param {string} name The level name, without its directory or extension.
   * @returns {Promise<void>}
   */
  async function loadLevel(name) {
    const raw = JSON.parse(await files.read(`levels/${name}.json`))
    loadedLevel = raw
    world.clear()
    // Clock, schedule and random stream all go back to zero together, so loading
    // a level is a clean starting point rather than "wherever the last run left
    // the clock". Without this, two simulate() runs differ by their history.
    loop.reset(raw.seed)
    editor.levelName = name
    editor.selection.clear()

    if (raw.camera) {
      view.x = raw.camera.at?.[0] ?? view.x
      view.y = raw.camera.at?.[1] ?? view.y
      view.z = raw.camera.at?.[2] ?? view.z
      view.zoom = raw.camera.zoom ?? view.zoom
      // `mode` is deliberately NOT copied here. The level's camera block is the
      // GAME camera — where the player looks while playing — and the game camera
      // plugin adopts it on play and hands it back on stop. Copying it at load
      // put the editor inside a first-person camera standing in a wall the
      // moment you opened a 3D level, and a black viewport is the worst thing
      // this engine can show.
      view.mode = 'ortho'
      view.fov = raw.camera.fov ?? view.fov
      view.yaw = raw.camera.yaw ?? view.yaw
      view.pitch = raw.camera.pitch ?? view.pitch
    }
    // Ids are position-in-file, not a counter, so `coin-2` means the same coin
    // after a reload. An agent that noted an id an hour ago can still use it.
    const seen = {}
    for (const p of raw.entities || []) {
      const e = world.spawn(p.type, p)
      if (!p.id) e.id = `${p.type}-${seen[p.type] = (seen[p.type] ?? -1) + 1}`
    }

    bus.emit('world:changed')
    // The camera rule rides along, because the kernel has already paid to parse
    // the file: a listener that re-read it from disk lost the race against a
    // one-shot headless run, which booted, played and simulated inside the read
    // and spent the whole run behind the editor's ortho view.
    bus.emit('level:loaded', name, raw.camera || {}, raw)
  }

  /**
   * @desc Write the open level back to disk with the entities' start positions,
   * or refuse when writing would corrupt it.
   * @domain level — saving the level currently open.
   * @effects Writes `levels/<name>.json` and returns its path, or returns a
   * `skipped` reason when the page is a viewer, the project is untitled, the
   * world has been simulated, or the world is playing.
   *
   * A level records starting positions. Once the simulation has run, the world
   * holds where things ended up, so writing it back would quietly replace the
   * level with a freeze-frame of a playthrough. Refuse, and say how to get back.
   *
   * @param {object} [options]
   * @param {boolean} [options.naming] Write an untitled project out under the name it just took.
   * @returns {Promise<object>} The path written, or why the save was skipped.
   */
  async function saveLevel({ naming = false } = {}) {
    // A page a lane opened to render in is a viewer: its world is its own, and
    // the checkout is shared. Checked before every other reason, because this
    // one is about who is asking rather than about what the world holds.
    if (globalThis.__engineViewer) {
      console.warn('[save] skipped — this page renders for a lane and never writes the checkout.')
      return { skipped: 'viewer' }
    }
    // The untitled project is scratch. Edits stay in the page, so a reload
    // drops them and nothing has to be undone. `project.saveAs` passes
    // `naming` to write them out as the project takes a name.
    if (editor.projectUntitled && !naming) {
      return { skipped: 'untitled', why: 'edits are held until the project is named — run project.saveAs <name> to keep them' }
    }
    if (world.simulated) {
      console.warn('[save] skipped — the world has been simulated, so it no longer holds start positions. Stop play mode (or engine.stop()) to reload the level first.')
      return { skipped: 'simulated' }
    }
    // A run is not an edit. Between pressing play and the first step the world
    // still holds start positions, so `simulated` is false and a save would go
    // through — rewriting the whole file, including a generated level, in the
    // editor's own formatting.
    if (loop.running) {
      console.warn('[save] skipped — the world is playing. Stop play mode first; a run is not an edit.')
      return { skipped: 'playing' }
    }
    // The editor's viewport is not the game's camera rule. In first person the
    // level says where the player looks from; overwriting that with wherever the
    // editor happened to be pointing would break the level by looking at it.
    // `mode` is the GAME's rule and is never written from here. The editor
    // always opens a level in ortho — that is what makes a 3D level editable —
    // so writing the editor's mode back turned every save of a first-person
    // level into a save that quietly demoted it to a flat one, and the only
    // symptom was pressing play and getting the 2D camera.
    const { mode, ...rule } = loadedLevel.camera || {}
    const camera = { ...rule, ...(mode ? { mode } : {}) }
    // The same argument, one key further: in a perspective editor view (the 3D
    // fly camera) view.x/y is where the author is LOOKING FROM, not where the
    // game camera should sit — writing it into `at` would move every future
    // play start to wherever the author happened to be flying. The flat view's
    // position is the only editor position that is also a level position.
    if (view.mode === 'ortho') {
      camera.at = [round(view.x), round(view.y)]
      camera.zoom = round(view.zoom)
    }
    const level = { ...loadedLevel, ...world.toLevel(camera) }
    await files.writeJSON(`levels/${editor.levelName}.json`, level)
    return { saved: `levels/${editor.levelName}.json` }
  }

  /**
   * @desc Start or stop play mode on the open level.
   * @domain play — running the level against the loop.
   * @effects Stops the loop and reloads the level when playing, or emits
   * `play:started`, runs every entity's `start` hook and starts the loop when
   * stopped. Emits `play:stopped` on stop and `plugins:changed` either way.
   * @returns {void}
   */
  editor.togglePlay = () => {
    if (loop.running) {
      loop.stop()
      // Announced before the level reloads, so a plugin can put back whatever
      // it borrowed — the camera restores the editor's viewport here.
      bus.emit('play:stopped')
      loadLevel(editor.levelName)
    } else {
      // Before the start hooks, so a plugin is listening when a hook spawns.
      // `loop.running` is therefore FALSE inside a `play:started` handler — a
      // handler that tests it does nothing at all. Hold, subscribe or schedule;
      // never gate on `running` here.
      bus.emit('play:started')
      for (const e of [...world.entities]) world.hook(e, 'start', context)
      loop.start()
    }
    bus.emit('plugins:changed')
  }
  editor.saveLevel = saveLevel
  editor.loadLevel = loadLevel
  editor.loadTypes = loadTypes
  editor.reloadType = reloadType
  editor.reloadBehaviour = reloadBehaviour

  // context surface plugins actually use — mirrors the game-side context on purpose
  Object.assign(context, {
    /**
     * @desc The project's assets, optionally filtered by kind.
     * @domain project — the asset index.
     * @pure Reads `editor.index.assets` and returns new objects.
     * @param {string} [kind] Keep only assets of this kind.
     * @returns {object[]} One `{ name, ...entry }` per matching asset.
     */
    assets: kind => Object.entries(editor.index.assets)
      .filter(([, a]) => !kind || a.kind === kind)
      .map(([name, a]) => ({ name, ...a })),
    /**
     * @desc The project's types, each with its name.
     * @domain project — the type index.
     * @pure Reads `editor.index.types` and returns new objects.
     * @returns {object[]} One `{ name, ...entry }` per type.
     */
    types: () => Object.entries(editor.index.types).map(([name, t]) => ({ name, ...t })),
    /**
     * @desc The project's behaviours, each with its name.
     * @domain project — the behaviour index.
     * @pure Reads `editor.index.behaviours` and returns new objects.
     * @returns {object[]} One `{ name, ...entry }` per behaviour.
     */
    behaviours: () => Object.entries(editor.index.behaviours || {}).map(([name, b]) => ({ name, ...b })),
    /**
     * @desc The project's levels, each with its name.
     * @domain project — the level index.
     * @pure Reads `editor.index.levels` and returns new objects.
     * @returns {object[]} One `{ name, ...entry }` per level.
     */
    levels: () => Object.entries(editor.index.levels).map(([name, l]) => ({ name, ...l })),
    level: () => editor.levelName,
    select: (x, additive) => editor.select(x, additive),
    /**
     * @desc Ask the editor to open a file.
     * @domain editor — the file the editor shows.
     * @effects Emits `open:file` with the file's path.
     * @param {string|object} file A file path, or an entry with a `file` path.
     * @returns {void}
     */
    open: file => bus.emit('open:file', typeof file === 'string' ? file : file.file),
    /**
     * @desc Add an entity to the world and announce it.
     * @domain world — entities.
     * @effects Spawns the entity in `world` and emits `world:changed`.
     * @param {string} t The type name.
     * @param {object} [p] The placement.
     * @returns {object} The spawned entity.
     */
    spawn: (t, p) => { const e = world.spawn(t, p); bus.emit('world:changed'); return e },
    /**
     * @desc Remove an entity from the world and announce it.
     * @domain world — entities.
     * @effects Runs the entity's destroy hooks in `world` and emits
     * `world:changed`.
     * @param {object} e The entity to remove.
     * @returns {void}
     */
    destroy: e => { world.destroy(e); bus.emit('world:changed') },
    run: (id, args) => context.engine.run(id, args),
    save: saveLevel,
    // One place that knows how to import a file out of the project, because the
    // browser imports it by URL and node imports it by path. Types, behaviours
    // and tests all go through this rather than each inventing a way.
    importProjectFile,
    // A world with no shell has nothing to redraw, and that is not an error.
    /**
     * @desc Ask the shell to redraw, when the world has a shell.
     * @domain shell — the browser's rendered view.
     * @effects Calls `context.shell.draw()` when a shell is attached.
     * @returns {void}
     */
    redraw: () => context.shell?.draw(),

    // Where a world point lands on screen, the same answer the renderer draws
    // by. Offered here because a project is a directory anywhere on disk, so
    // game code cannot reach an engine module by a relative path.
    /**
     * @desc A projector for the current view and viewport.
     * @domain camera — world point to screen point.
     * @pure Builds a projector from `context.view` and `context.viewport`.
     * @returns {object} The projector.
     */
    projector: () => makeProjector(context.view, context.viewport),

    // The deterministic runtime. Game code uses these instead of the wall clock,
    // Math.random and setTimeout — which is what makes simulate() repeatable.
    random: loop.random,
    // For anything that only draws. Kept apart from `random` so a change to an
    // effect cannot move where an enemy spawns.
    drawing: loop.drawing,
    after: (seconds, fn) => loop.after(seconds, fn),
    every: (seconds, fn) => loop.every(seconds, fn),
    cancel: id => loop.cancel(id)
  })

  // A getter, not a copied number: `context.time` has to read the clock at the
  // moment the hook asks, not the moment context was built.
  Object.defineProperty(context, 'time', { enumerable: true, get: () => loop.time })

  // Object.assign would have invoked this getter once and frozen the result —
  // it has to be defined, not copied, or every plugin reads a stale selection.
  Object.defineProperty(context, 'selection', {
    // enumerable matters: the shell hands panels `{ ...context, state }`, and a
    // non-enumerable property is dropped by spread.
    enumerable: true,
    get: () => [...editor.selection].map(id => world.byId(id)).filter(Boolean)
  })

  // ---------------------------------------------------------------- run
  const found = await loadPlugins(loader)
  // Where a plugin was found travels beside it rather than being guessed from
  // its name later. Sorting works on definitions, so the flag is carried in a
  // side map instead of being copied onto the definition itself.
  const cameFromBuiltin = new Map(found.map(f => [f.definition, f.builtin === true]))
  for (const definition of loader.order(found.map(f => f.definition))) {
    loader.add(definition, cameFromBuiltin.get(definition) === true)
  }

  // Turning a plugin off has to mean it never ran, so the list is applied
  // before boot.
  for (const name of game.plugins?.disabled || []) loader.enable(name, false)

  loader.boot(context)

  // Started here and awaited at the end, so the wait runs alongside the index,
  // the types and the level rather than after them.
  const starting = startup.settled()

  // The screen, if there is one. Between booting the plugins and loading the
  // project, because a panel must exist before the first level:loaded fires.
  await attachScreen(context)

  editor.index = await files.index()
  await loadTypes()

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
  if (start) await loadLevel(start)

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
