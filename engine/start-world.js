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

/**
 * How big the viewport is, when nothing has measured one.
 *
 * The camera clamps to level bounds using the viewport size, so without a fixed
 * default the same level would frame differently in a small window than in a
 * large one — and a headless run would disagree with both. Declaring it means a
 * camera position is reproducible, which is the whole promise of `simulate()`.
 */
const DEFAULT_VIEWPORT = { width: 1280, height: 720 }

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

export async function startWorld({
  /**
   * (bus) => the file reader and writer. A factory rather than a ready-made
   * object because files announce their writes on the bus, and the bus is
   * created here — passing one in would mean two of them.
   */
  openFiles,
  /** async () => [{ definition, builtin }] — a glob in the browser, readdir in node. */
  loadPlugins,
  /** async (file) => the module's default export, for types, behaviours and tests. */
  importProjectFile,
  /**
   * Which directory under the checkout holds the project.
   *
   * A parameter, and one a plugin has to be able to read: the browser learns it
   * from the dev server and node is told it with `--project`, and before this
   * was passed through, anything asking reached for `process.env.ENGINE_PROJECT`
   * — which `--project` never sets. `plugin.sizes` measured the default
   * project's plugins while reading another project's title, and said nothing.
   */
  projectDirectory = 'project',
  /** The browser mounts its shell and renderer here. Headless does nothing. */
  attachScreen = async () => {},
  viewport = { ...DEFAULT_VIEWPORT },
  view = { ...DEFAULT_VIEW }
} = {}) {
  const bus = makeBus()
  // Made before the plugins load, so errors raised while the world is built
  // reach `snapshot().errors`.
  const log = makeLog(bus)
  const world = makeWorld(bus)
  const loader = makeLoader(bus)
  const files = openFiles(bus)

  const editor = {
    // The directory, which is a parameter; and the title, which the project's
    // own game.json sets below. Two different questions — a panel showing the
    // title and a plugin reading `<project>/plugins` need different answers.
    projectDirectory,
    projectName: 'project',
    levelName: '—',
    selection: new Set(),
    tool: 'select',
    index: { types: {}, behaviours: {}, levels: {}, assets: {}, config: [] },
    camera: null,
    context: null,

    select(ids, additive = false) {
      const list = [].concat(ids ?? []).map(v => (typeof v === 'string' ? v : v?.id)).filter(Boolean)
      if (!additive) editor.selection.clear()
      for (const id of list) editor.selection.add(id)
      bus.emit('selection:changed', [...editor.selection])
    },

    setTool(id) {
      editor.tool = id
      bus.emit('tool:changed', id)
      bus.emit('plugins:changed')
    }
  }

  const context = {}
  Object.assign(context, { world, files, bus, loader, editor, view, viewport })
  editor.context = context
  // world.destroy runs onDestroy and needs a context to hand it. Without this the
  // hook received undefined, which nothing noticed because most onDestroy
  // hooks only touch the entity.
  world.context = context

  const loop = makeLoop({
    onError(e) { console.error('[timer]', e) },
    onFixed(seconds) {
      // One flag, set at the only place time advances, so nothing can step the
      // world without marking it — including engine.simulate().
      world.simulated = true
      for (const s of loader.contrib.systems) {
        if (s.phase !== 'fixed') continue
        try { s.run(world, seconds, context) } catch (e) { loader.fail(s.plugin, e) }
      }
      // world.hook runs the attached behaviours first, then the type's own
      // update — so a type always gets the last word on what it composed.
      for (const e of [...world.entities]) world.hook(e, 'update', seconds, context)
    },
    onFrame(seconds) {
      for (const s of loader.contrib.systems) {
        if (s.phase !== 'frame') continue
        try { s.run(world, seconds, context) } catch (e) { loader.fail(s.plugin, e) }
      }
      // Optional on purpose: a world with no renderer runs the same systems in
      // the same order and simply draws nothing.
      context.renderer?.sync(world)
      context.renderer?.draw()
    }
  })
  context.loop = loop

  // ---------------------------------------------------------------- project
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
   * Re-import one type and bring its live entities onto the new definition.
   * Returns how many entities moved, or throws with whatever the file did wrong.
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

  /** The same, for a behaviour. Every entity that attached it moves onto the new file. */
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
    bus.emit('level:loaded', name, raw.camera || {})
  }

  /**
   * A level records starting positions. Once the simulation has run, the world
   * holds where things ended up, so writing it back would quietly replace the
   * level with a freeze-frame of a playthrough. Refuse, and say how to get back.
   */
  async function saveLevel() {
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
  }

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
    assets: kind => Object.entries(editor.index.assets)
      .filter(([, a]) => !kind || a.kind === kind)
      .map(([name, a]) => ({ name, ...a })),
    types: () => Object.entries(editor.index.types).map(([name, t]) => ({ name, ...t })),
    behaviours: () => Object.entries(editor.index.behaviours || {}).map(([name, b]) => ({ name, ...b })),
    levels: () => Object.entries(editor.index.levels).map(([name, l]) => ({ name, ...l })),
    level: () => editor.levelName,
    select: (x, additive) => editor.select(x, additive),
    open: file => bus.emit('open:file', typeof file === 'string' ? file : file.file),
    spawn: (t, p) => { const e = world.spawn(t, p); bus.emit('world:changed'); return e },
    destroy: e => { world.destroy(e); bus.emit('world:changed') },
    run: (id, args) => context.engine.run(id, args),
    save: saveLevel,
    // One place that knows how to import a file out of the project, because the
    // browser imports it by URL and node imports it by path. Types, behaviours
    // and tests all go through this rather than each inventing a way.
    importProjectFile,
    // A world with no shell has nothing to redraw, and that is not an error.
    redraw: () => context.shell?.draw(),

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

  // Which plugins are off, before any of them run. game.json used to be read
  // after boot and the list applied by a plugin's own onLoad, so a "disabled"
  // plugin still had its onLoad called — it had already subscribed, taken a
  // context key and registered whatever it registers, and only then was marked
  // off. Turning a plugin off has to mean it never ran, or it does not mean
  // anything.
  let game = {}
  try { game = JSON.parse(await files.read('game.json')) } catch { /* optional */ }
  for (const name of game.plugins?.disabled || []) loader.enable(name, false)

  loader.boot(context)

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

  // `reload` reports that the page reloaded and the world was rebuilt. It is a
  // function because it answers once, then answers nothing.
  const engine = makeInspect({ world, loader, loop, files, bus, editor, view, log, reload: takeReloadNote })
  context.engine = engine

  // Editing engine or plugin source is a full page reload, and a page reload
  // takes the world with it. Put the moment back where the last page left one,
  // and say what happened either way — a rebuilt world nobody announced is a
  // world an agent will go on debugging as though it were the old one. Nothing
  // here costs a headless world anything: there is no session to restore from.
  await carryWorldThroughReload({ world, loop, editor, view, bus, context, engine })

  return { context, engine, world, loop, loader, bus, files, editor, view, viewport }
}

const round = n => Math.round(n * 1000) / 1000
