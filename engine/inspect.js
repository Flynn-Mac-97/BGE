/**
 * Kernel: the read and drive surface.
 *
 * Everything the editor can do is a command, so `engine.run(id, args)` is a
 * complete way to drive it. Everything the editor knows is in `engine.snapshot()`,
 * which is deliberately summarised by default and detailed on request — a full
 * entity dump every time would be the expensive thing to read.
 *
 * Exposed as window.engine so an agent driving the browser can inspect state
 * and act without screenshots.
 */
const RING = 200

export function makeInspect({ world, loader, loop, files, bus, editor, view }) {
  const log = []

  const push = (level, source, message, extra) => {
    log.push({ t: Math.round(performance.now()), level, source, message, ...extra })
    if (log.length > RING) log.shift()
  }

  bus.on('plugin:error', ({ name, error }) => push('error', `plugin:${name}`, error))
  bus.on('files:written', ({ path }) => push('info', 'files', `wrote ${path}`))

  // "I wrote the file — did it take?" has to be answerable from the log, or an
  // agent has no way to tell a hot swap that worked from one that never ran.
  bus.on('hot:applied', c => push('info', 'hot',
    `${c.file} ${c.removed ? 'removed' : c.entities != null ? `→ ${c.entities} entities` : c.skipped || 'applied'}`))
  bus.on('hot:failed', c => push('error', 'hot', `${c.file} — ${c.error}`))

  const origError = console.error
  console.error = (...args) => {
    push('error', 'console', args.map(a => (a?.stack || a?.message || String(a))).join(' '))
    origError.apply(console, args)
  }

  // console.error only catches what someone remembered to log. An uncaught
  // throw or a rejected promise in game code would otherwise be invisible here
  // — the log would say the run was clean while the run was not.
  //
  // Node reports the same two things under different names, so both are wired
  // up. A headless run that silently swallowed an uncaught throw would be the
  // worst possible thing to hand an agent working without a screen.
  const uncaught = (error, at) => push('error', 'uncaught', error?.stack || error?.message || String(error), { at })
  const rejected = reason => push('error', 'rejection', reason?.stack || reason?.message || String(reason))

  if (typeof addEventListener === 'function') {
    addEventListener('error', event => uncaught(event.error || event.message,
      event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined))
    addEventListener('unhandledrejection', event => rejected(event.reason))
  } else if (typeof process !== 'undefined' && typeof process.on === 'function') {
    process.on('uncaughtException', error => uncaught(error))
    process.on('unhandledRejection', reason => rejected(reason))
  }

  /**
   * `bulk` trims properties to the overridden ones. In a list of fifty entities the
   * type defaults are the same fifty times and are already in the index, so
   * repeating them is the single most wasteful thing this surface can do.
   * A single-entity lookup is cheap, so that one stays complete.
   */
  const entityView = (e, bulk = false) => {
    const out = {
      id: e.id, type: e.type,
      at: [r(e.x), r(e.y), r(e.z)],
      ...(e.rotation ? { rotation: r(e.rotation) } : {})
    }
    if (bulk) {
      // In bulk, properties IS the override list — naming the keys twice is waste.
      if (e.overrides.length) out.properties = Object.fromEntries(e.overrides.map(k => [k, e.properties[k]]))
      // Names only. What each one holds is in the index, once, rather than
      // repeated on every entity that attached it.
      if (e.behaviours.length) out.behaviours = e.behaviours.map(b => b.name)
    } else {
      out.properties = e.properties
      if (e.overrides.length) out.overrides = e.overrides
      if (e.behaviours.length) {
        out.behaviours = Object.fromEntries(e.behaviours.map(b =>
          [b.name, b.error ? { error: b.error } : b.bag]))
      }
    }
    return out
  }

  const api = {
    /** Compact by default. Pass { entities:true, log:true, plugins:true } for detail. */
    snapshot(options = {}) {
      const types = [...world.types.keys()]
      const out = {
        mode: loop.running ? 'play' : 'edit',
        level: editor.levelName,
        // Engine time and seed, because "what happened" is only reproducible
        // if you know where the clock and the random stream were.
        time: r(loop.time),
        seed: loop.random.seed,
        camera: { x: r(view.x), y: r(view.y), zoom: r(view.zoom), mode: view.mode },
        counts: {
          entities: world.entities.length,
          types: types.length,
          behaviours: world.behaviours.size,
          plugins: [...loader.plugins.values()].filter(p => p.enabled).length
        },
        selection: [...editor.selection],
        byType: types.reduce((a, t) => (a[t] = world.all(t).length, a), {}),
        errors: log.filter(l => l.level === 'error').slice(-5),
        unsaved: files.pending > 0
      }
      if (options.entities) out.entities = world.entities.map(e => entityView(e, true))
      if (options.plugins) out.plugins = [...loader.plugins.entries()]
        .map(([name, p]) => ({ name, enabled: p.enabled, error: p.error }))
      if (options.log) out.log = log.slice(-40)
      if (options.timers) out.timers = loop.timers
      if (options.commands) out.commands = loader.contrib.commands.map(c => c.id)
      return out
    },

    /**
     * Every verb the editor has, including ones plugins added.
     *
     * Toolbar entries are included. A button a person can press has to be
     * reachable from a terminal too, or the two ways of driving the editor
     * quietly diverge.
     */
    commands() {
      return [
        ...loader.contrib.commands.map(c => ({ id: c.id, label: c.label, plugin: c.plugin })),
        ...loader.contrib.menus.map(m => ({ id: m.id, label: m.label, plugin: m.plugin, toolbar: true }))
      ]
    },

    run(id, args) {
      const command = loader.contrib.commands.find(c => c.id === id)
        || loader.contrib.menus.find(m => m.id === id)
      if (!command) throw new Error(`no command "${id}". Try engine.commands()`)
      const out = command.run(editor.context, args)
      // A toolbar entry changes what is on screen, so redraw for it — a person
      // pressing the button gets that from the shell.
      if (command.toolbar !== false && loader.contrib.menus.includes(command)) editor.context.redraw()
      return out
    },

    entity(id) {
      const e = world.byId(id)
      return e ? entityView(e) : null
    },

    // ---- direct verbs, for driving without going through a command ----
    select: ids => editor.select(ids),
    play: () => { if (!loop.running) editor.togglePlay() },

    /**
     * Back to the level as authored. simulate() advances time without ever
     * entering play mode, so stopping has to cover that case too or a headless
     * agent has no way to undo a simulation.
     */
    stop: () => {
      if (loop.running) editor.togglePlay()
      else if (world.simulated) editor.loadLevel(editor.levelName)
    },

    /**
     * Run the simulation for `seconds` deterministically, without waiting on
     * real time or a visible tab. Returns the resulting snapshot, so a single
     * call answers "what happens if I let this run".
     */
    simulate(seconds = 1, options = {}) {
      const started = loop.running
      if (!started) {
        // Marked before the hooks, not after the first step. A start hook is
        // only running because a simulation asked for it, and anything it
        // spawns is already a simulated entity — so the flag that means "these
        // are no longer start positions" has to be true while they run. It is
        // what stops a hook's own save writing a mid-simulation level, and what
        // keeps those spawns out of the History palette.
        world.simulated = true
        for (const e of [...world.entities]) world.hook(e, 'start', editor.context)
      }
      loop.step(Math.round(seconds * 60))
      return api.snapshot({ entities: true, ...options })
    },
    spawn: (type, placement) => entityView(editor.context.spawn(type, placement)),
    destroy: id => editor.context.destroy(world.byId(id)),

    /** Set a field or prop on an entity and persist it. */
    set(id, key, value) {
      const e = world.byId(id)
      if (!e) throw new Error(`no entity "${id}"`)
      if (key in e.properties) {
        e.properties[key] = value
        if (!e.overrides.includes(key)) e.overrides.push(key)
      } else e[key] = value
      bus.emit('world:changed')
      editor.saveLevel()
      return entityView(e)
    },

    /**
     * Re-seed the random stream and restart the clock.
     *
     * Same seed, same level, same steps — same result. Varying the seed is how
     * you check that behaviour holds generally rather than by luck.
     */
    seed(value) {
      loop.reset(value)
      return { seed: loop.random.seed, time: loop.time }
    },

    log: (n = 40) => log.slice(-n),
    errors: () => log.filter(l => l.level === 'error'),
    clearLog: () => { log.length = 0 },

    // direct handles for anything the summary does not cover
    world, loader, loop, files, bus, editor, view,

    // Undefined when nothing is drawing, which is the honest answer rather than
    // a stub that pretends to render.
    get renderer() { return editor.context?.renderer }
  }

  return api
}

const r = n => Math.round(n * 1000) / 1000
