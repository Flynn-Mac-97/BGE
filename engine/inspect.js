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

/**
 * The world's log, and everything that has to be listening before there is a
 * world to read.
 *
 * It is made apart from the read surface because the read surface is built
 * last — after the plugins have been found, imported and booted. A world that
 * breaks while it is starting is exactly the world whose errors an agent most
 * needs, and it was the one case where `snapshot().errors` came back empty.
 * Make this first, hand it to `makeInspect` at the end, and everything that
 * went wrong on the way is already in it.
 */
export function makeLog(bus) {
  const lines = []

  const push = (level, source, message, extra) => {
    lines.push({ t: Math.round(performance.now()), level, source, message, ...extra })
    if (lines.length > RING) lines.shift()
  }

  bus.on('plugin:error', failure =>
    push('error', failure.file ? 'plugin' : `plugin:${failure.name}`, reasonFor(failure)))
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

  return { lines, push }
}

export function makeInspect({ world, loader, loop, files, bus, editor, view, log, reload }) {
  /**
   * Add the reload note to a reply, once.
   *
   * A page reload rebuilds the world. Unreported, an agent keeps reading the
   * new world as the old one. The field is named for the outcome —
   * `worldWasRestored` or `worldWasReset` — and is absent when there is
   * nothing to report, so it never becomes noise.
   */
  const note = out => {
    const said = reload?.()
    if (said) out[said.key] = said.sentence
    return out
  }

  /** A reply with room for one more key: a plain object, not a number or a list. */
  const plainReply = value =>
    !!value && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)

  // A log made here started after the plugins did, so it heard none of what
  // they raised. Read that back out of the loader. A log passed in was already
  // listening and has it all, in the order it happened.
  const listenedFromTheStart = log != null
  log ??= makeLog(bus)
  if (!listenedFromTheStart) {
    for (const failure of loader.failures()) log.push('error', 'plugin', reasonFor(failure))
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
      ...(e.rotation ? { rotation: r(e.rotation) } : {}),
      // Why this one is placed here. In a bulk list it is the only description
      // that appears, and only on the placements that wrote one — what the type
      // IS is said once per type, not once per entity.
      ...(e.note ? { note: e.note } : {})
    }
    if (bulk) {
      // In bulk, properties IS the override list — naming the keys twice is waste.
      if (e.overrides.length) out.properties = Object.fromEntries(e.overrides.map(k => [k, e.properties[k]]))
      // Names only. What each one holds is in the index, once, rather than
      // repeated on every entity that attached it.
      if (e.behaviours.length) out.behaviours = e.behaviours.map(b => b.name)
    } else {
      // What the author wrote this type IS, read through the definition rather
      // than copied onto the entity, so editing the type file reaches every
      // live entity with nothing to re-sync. Identity comes before the numbers
      // because a reader has to know what the thing is to read them.
      const definition = e._definition || {}
      if (definition.about) out.about = definition.about
      if (definition.appearance) out.appearance = definition.appearance
      if (definition.looksWrongWhen) out.looksWrongWhen = definition.looksWrongWhen
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
      const broken = loader.failures()
      const out = {
        mode: loop.running ? 'play' : 'edit',
        // Which project answered. A command that omits `--project` opens the
        // default one and says nothing, so a reply about the wrong game reads
        // exactly like a reply about the right one.
        project: editor.projectDirectory,
        level: editor.levelName,
        // Engine time and seed, because "what happened" is only reproducible
        // if you know where the clock and the random stream were.
        time: r(loop.time),
        // Only when something is holding time still. "Nothing is moving" is the
        // hardest thing to diagnose without being told who asked for that.
        ...(loop.paused ? { paused: loop.holds } : {}),
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
        errors: log.lines.filter(l => l.level === 'error').slice(-5),
        // Its own key, not a line in the error ring, because the ring keeps the
        // last five and a broken plugin must not be pushed out of the summary
        // by five later complaints. Absent when everything loaded, so the
        // healthy snapshot is the size it always was.
        ...(broken.length ? { pluginsFailed: broken.map(reasonFor) } : {}),
        unsaved: files.pending > 0
      }
      if (options.entities) out.entities = world.entities.map(e => entityView(e, true))
      if (options.plugins) out.plugins = [...loader.plugins.entries()]
        .map(([name, p]) => (p.file
          // A file that never imported has no name to show. Say what it is
          // instead of printing a path where a name belongs.
          ? { file: p.file, loaded: false, builtin: p.builtin, error: p.error }
          : { name, enabled: p.enabled, error: p.error }))
      if (options.log) out.log = log.lines.slice(-40)
      if (options.timers) out.timers = loop.timers
      if (options.commands) out.commands = loader.contrib.commands.map(c => c.id)
      return note(out)
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

    // Async, because a command handler may be. Both callers — the CLI and the
    // bridge — await the answer, so an async command reports what it measured
    // instead of a pending promise.
    async run(id, args) {
      const command = loader.contrib.commands.find(c => c.id === id)
        || loader.contrib.menus.find(m => m.id === id)
      if (!command) throw new Error(missingCommand(id, loader.failures()))
      const out = await command.run(editor.context, args)
      // A toolbar entry changes what is on screen, so redraw for it — a person
      // pressing the button gets that from the shell.
      if (command.toolbar !== false && loader.contrib.menus.includes(command)) editor.context.redraw()
      // A waiting note rides on a reply the agent is already reading, but only
      // on a plain object. A command answering with a number or a list answers
      // with exactly that; the note waits for the next reply that can hold it.
      return plainReply(out) ? note({ ...out }) : out
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
     *
     * Compact by default, the same as `snapshot`. Pass `{ entities: true }`
     * for the list. A simulate step inside a script is rarely the reply the
     * caller wants, and the full entity dump costs 63KB a call.
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
      return api.snapshot(options)
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

    log: (n = 40) => log.lines.slice(-n),
    errors: () => log.lines.filter(l => l.level === 'error'),
    clearLog: () => { log.lines.length = 0 },

    // direct handles for anything the summary does not cover
    world, loader, loop, files, bus, editor, view,

    // Undefined when nothing is drawing, which is the honest answer rather than
    // a stub that pretends to render.
    get renderer() { return editor.context?.renderer }
  }

  return api
}

const r = n => Math.round(n * 1000) / 1000

/** One plugin failure in a sentence, for a log line or a snapshot. */
const reasonFor = failure => failure.file
  ? `${failure.file} failed to import — ${failure.error}. Every command it contributes is missing.`
  : `plugin "${failure.name}" failed to load — ${failure.error}. Every command it contributes is missing.`

/**
 * Why a command is not here.
 *
 * A plugin whose file throws on import contributes nothing, so all of its verbs
 * read as missing and the only symptom is the name of one of them. Hunting a
 * command that is not missing but broken costs an afternoon, so the reply names
 * every plugin that failed and what it failed with. Nothing failed, nothing
 * extra is said — the ordinary typo keeps the short answer it deserves.
 */
const missingCommand = (id, failures) => {
  if (!failures.length) return `no command "${id}". Try engine.commands()`
  const why = failures.map(f => f.file
    ? `Plugin file ${f.file} failed to import: ${f.error}.`
    : `Plugin "${f.name}" failed to load: ${f.error}.`).join(' ')
  return `no command "${id}". ${why} Every command those plugins contribute is missing, ` +
    `which may be this one. Try engine.commands()`
}
