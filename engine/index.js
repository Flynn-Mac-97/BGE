/**
 * Kernel boot.
 *
 * Assemble the six kernel modules, load every plugin through the same path,
 * load the project, mount the shell. Nothing here knows what a panel is.
 */
import { makeBus } from './bus.js'
import { makeWorld } from './world.js'
import { makeLoop } from './loop.js'
import { makeFiles } from './files.js'
import { makeLoader } from './loader.js'
import { makeRenderer } from './render.js'
import { makeShell } from './shell.js'
import { makeInspect } from './inspect.js'

const bus = makeBus()
const world = makeWorld(bus)
const files = makeFiles(bus)
const loader = makeLoader(bus)

const editor = {
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

let renderer, shell, loop

// ---------------------------------------------------------------- plugins
async function loadPlugins() {
  const builtin = import.meta.glob('/plugins/builtin/*.js')
  const project = import.meta.glob('/project/plugins/*.js')
  const defs = []
  const fromBuiltin = new Set()

  for (const [path, load] of Object.entries({ ...builtin, ...project })) {
    try {
      const definition = (await load()).default
      if (!definition) continue
      defs.push(definition)
      if (path in builtin) fromBuiltin.add(definition)
    } catch (e) {
      console.error(`[loader] ${path} failed to import`, e)
    }
  }

  for (const definition of loader.order(defs)) loader.add(definition, fromBuiltin.has(definition))
}

// ---------------------------------------------------------------- project
/**
 * Types are read from the generated index and imported by URL, not through
 * `import.meta.glob`.
 *
 * A glob is expanded when the page is built, so a type file created after that
 * does not exist as far as the running editor is concerned — writing a new type
 * would require a reload before it could be used. The index is rebuilt by the
 * server on every write, so this path sees new files immediately.
 */
let typeVersion = 0

async function importType(name, file) {
  const url = `/project/${file}?hot=${++typeVersion}`
  const loaded = await import(/* @vite-ignore */ url)
  return loaded.default || {}
}

/**
 * Behaviours load before types, because a type's attachment list is resolved
 * the moment the type registers. Loading them the other way round would leave
 * every attachment reporting "no behaviours/x.js" on a perfectly good project.
 */
async function loadTypes() {
  world.behaviours.clear()
  for (const [name, b] of Object.entries(editor.index.behaviours || {})) {
    try {
      world.registerBehaviour(name, await importType(name, b.file))
    } catch (e) {
      console.error(`[behaviours] ${name} failed`, e)
    }
  }

  world.types.clear()
  for (const [name, t] of Object.entries(editor.index.types)) {
    try {
      world.registerType(name, await importType(name, t.file))
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
  const moved = world.retype(name, await importType(name, entry.file))
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
  const moved = world.rebehave(name, await importType(name, entry.file))
  bus.emit('world:changed')
  return { name, entities: moved }
}

async function loadLevel(name) {
  const raw = JSON.parse(await files.read(`levels/${name}.json`))
  world.clear()
  // Clock, schedule and random stream all go back to zero together, so loading
  // a level is a clean starting point rather than "wherever the last run left
  // the clock". Without this, two simulate() runs differ by their history.
  loop.reset(raw.seed)
  editor.levelName = name
  editor.selection.clear()

  if (raw.camera) {
    renderer.view.x = raw.camera.at?.[0] ?? renderer.view.x
    renderer.view.y = raw.camera.at?.[1] ?? renderer.view.y
    renderer.view.zoom = raw.camera.zoom ?? renderer.view.zoom
    renderer.view.mode = raw.camera.mode ?? 'ortho'
  }
  // Ids are position-in-file, not a counter, so `coin-2` means the same coin
  // after a reload. An agent that noted an id an hour ago can still use it.
  const seen = {}
  for (const p of raw.entities || []) {
    const e = world.spawn(p.type, p)
    if (!p.id) e.id = `${p.type}-${seen[p.type] = (seen[p.type] ?? -1) + 1}`
  }

  bus.emit('world:changed')
  bus.emit('level:loaded', name)
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
  const level = world.toLevel({
    mode: renderer.view.mode,
    at: [round(renderer.view.x), round(renderer.view.y)],
    zoom: round(renderer.view.zoom)
  })
  await files.writeJSON(`levels/${editor.levelName}.json`, level)
}

// ---------------------------------------------------------------- run
async function boot() {
  const root = document.getElementById('app')

  // The shell builds the canvas the renderer draws into, so the shell comes
  // first and context.renderer is filled in immediately after.
  const context = {}
  Object.assign(context, { world, files, bus, loader, editor })
  editor.context = context
  // world.destroy runs onDestroy and needs a context to hand it. Without this the
  // hook received undefined, which nothing noticed because most onDestroy
  // hooks only touch the entity.
  world.context = context

  loop = makeLoop({
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
      renderer.sync(world)
      renderer.draw()
    }
  })
  context.loop = loop

  editor.togglePlay = () => {
    if (loop.running) {
      loop.stop()
      // Announced before the level reloads, so a plugin can put back whatever
      // it borrowed — the camera restores the editor's viewport here.
      bus.emit('play:stopped')
      loadLevel(editor.levelName)
    } else {
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
    run: (id, args) => window.engine.run(id, args),
    save: saveLevel,
    redraw: () => shell.draw(),

    // The deterministic runtime. Game code uses these instead of the wall clock,
    // Math.random and setTimeout — which is what makes simulate() repeatable.
    random: loop.random,
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

  await loadPlugins()
  loader.boot(context)

  shell = makeShell(root, context)
  context.shell = shell

  renderer = makeRenderer(shell.canvas, bus)
  context.renderer = renderer
  renderer.resize()

  editor.index = await files.index()
  await loadTypes()

  // game.json says which level opens. Falling back to "whichever sorts first"
  // means adding a level can silently change which one you land in — and the
  // first thing you would do is edit the wrong file.
  const levels = Object.keys(editor.index.levels)
  let game = {}
  try { game = JSON.parse(await files.read('game.json')) } catch { /* optional */ }
  editor.game = game
  editor.projectName = game.title || editor.projectName

  const start = levels.includes(game.startLevel) ? game.startLevel : levels[0]
  if (game.startLevel && start !== game.startLevel) {
    console.error(`[project] game.json startLevel "${game.startLevel}" does not exist — opening "${start}"`)
  }
  if (start) await loadLevel(start)

  window.engine = makeInspect({ world, loader, loop, files, bus, renderer, editor })

  bus.on('open:file', () => shell.draw())
  shell.draw()

  // plugins that need DOM (viewport tools) wait for this rather than onLoad
  bus.emit('shell:ready', context)

  // Edit mode still needs to draw, just without stepping the simulation.
  // Falls back to a timer when the tab is hidden so a headless agent still
  // gets a rendered canvas to screenshot.
  const paint = () => { if (!loop.running) { renderer.sync(world); renderer.draw() } }
  const idle = () => { paint(); requestAnimationFrame(idle) }
  idle()
  setInterval(() => { if (document.hidden) paint() }, 100)

  console.log('%cengine ready', 'font-weight:600', '— try engine.snapshot() or engine.commands()')
}

const round = n => Math.round(n * 1000) / 1000

boot().catch(e => {
  document.getElementById('app').innerHTML =
    `<pre style="padding:24px;font:12px ui-monospace">boot failed\n\n${e.stack || e}</pre>`
  console.error(e)
})
