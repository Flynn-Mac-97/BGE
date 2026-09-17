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
import { validateCommandInput } from './command-schema.js'
import { stateHash } from './world.js'
const RING = 200

/** Half a fixed step. Below this, a simulation ran the time it was asked for. */
const STEP_TOLERANCE = 1 / 120

/**
 * Every log in this process, held weakly.
 *
 * A world wants what the console would not have caught, and node and the browser
 * both report an uncaught throw and a rejected promise on one process-wide
 * channel. Wiring that up per world meant eleven worlds installed eleven pairs of
 * listeners — which node warns about at eleven — each one collecting every other
 * world's errors, and each one holding its own world's log reachable for the life
 * of the process. Weak, because the thing that reports errors must never be the
 * reason a world cannot be let go of.
 */
const LOGS = new Set()

/** Whether the process-wide channels are wired. One set, however many worlds. */
let wired = false

/** Say something to every log still alive, and forget the ones that are not. */
function reportToLogs(level, source, message, extra) {
  for (const reference of LOGS) {
    const log = reference.deref()
    if (log) log.push(level, source, message, extra)
    else LOGS.delete(reference)
  }
}

/**
 * Wire the channels a world cannot listen for itself, once.
 *
 * `console.error` only catches what someone remembered to log. An uncaught throw
 * or a rejected promise in game code would otherwise be invisible — the log would
 * say the run was clean while the run was not — and that is the worst thing to
 * hand an agent working without a screen. Wrapped once rather than once per world,
 * so eleven worlds are not eleven nested wrappers passing everything along.
 */
function wireOnce() {
  if (wired) return
  wired = true

  const uncaught = (error, at) => reportToLogs('error', 'uncaught',
    error?.stack || error?.message || String(error), { at })
  const rejected = reason => reportToLogs('error', 'rejection',
    reason?.stack || reason?.message || String(reason))

  if (typeof addEventListener === 'function') {
    addEventListener('error', event => uncaught(event.error || event.message,
      event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined))
    addEventListener('unhandledrejection', event => rejected(event.reason))
  } else if (typeof process !== 'undefined' && typeof process.on === 'function') {
    process.on('uncaughtException', error => uncaught(error))
    process.on('unhandledRejection', reason => rejected(reason))
  }

  const original = console.error
  console.error = (...args) => {
    reportToLogs('error', 'console', args.map(a => (a?.stack || a?.message || String(a))).join(' '))
    original.apply(console, args)
  }
}

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
  // An error, not a note: a write that did not land is the one thing a reader
  // must not miss, and the reason names who is holding the file.
  bus.on('files:refused', ({ message }) => push('error', 'files', message))

  // "I wrote the file — did it take?" has to be answerable from the log, or an
  // agent has no way to tell a hot swap that worked from one that never ran.
  bus.on('hot:applied', c => push('info', 'hot',
    `${c.file} ${c.removed ? 'removed' : c.entities != null ? `→ ${c.entities} entities` : c.skipped || 'applied'}`))
  bus.on('hot:failed', c => push('error', 'hot', `${c.file} — ${c.error}`))

  const log = { lines, push }
  // This world is now one of the logs a process-wide error is reported to, and
  // the wiring is installed if this is the first world to ask.
  LOGS.add(new WeakRef(log))
  wireOnce()
  return log
}

/**
 * The columns one row of a bulk entity list can carry.
 *
 * Named here rather than discovered from the first row, so a projection can refuse a
 * field that does not exist instead of answering with a column of nulls — which reads
 * as a world where nothing has a rotation.
 */
const ENTITY_COLUMNS = ['id', 'type', 'at', 'rotation', 'note', 'properties', 'behaviours']

/**
 * Rows as columns: the field names once, then one array per row.
 *
 * A dump of four hundred and forty entities is 22 KB as rows of objects and 14 KB as
 * columns, because the names are a third of it. The projection is the larger half —
 * the same dump of `id` and `at` is 9 KB — and it is the same data, so a caller that
 * asks for two columns gets two columns rather than reading seven and discarding five.
 *
 * @param {object[]} rows One object per row.
 * @param {string[]} fields Which of its fields to keep, in this order.
 * @returns {object} `{ columns, rows }`.
 */
const asColumns = (rows, fields) => ({
  columns: fields,
  rows: rows.map(row => fields.map(field => row[field]))
})

/**
 * The fields a projection named, checked.
 *
 * @param {string|string[]} asked Field names, or one string of them separated by commas.
 * @param {string[]} known Every field this reply's rows can carry.
 * @returns {string[]} The names, in the order asked for.
 * @throws When a name is not a field of this row, naming the ones that are.
 */
function wantedFields(asked, known) {
  const fields = (Array.isArray(asked) ? asked : String(asked).split(','))
    .map(field => String(field).trim())
    .filter(Boolean)
  if (!fields.length) throw new Error(`name the fields to keep, separated by commas — this row carries ${known.join(', ')}`)
  const wrong = fields.filter(field => !known.includes(field))
  if (wrong.length) throw new Error(`no field "${wrong.join('", "')}" — this row carries ${known.join(', ')}`)
  return fields
}

/**
 * The read and drive surface: `snapshot`, `run`, `simulate`, and the direct
 * verbs a script uses instead of going through a command.
 *
 * It reads the same objects the loop and the plugins write, so an answer is
 * what the world holds at the moment asked. `reload` is the one-shot note from
 * a page reload; it is appended to the first plain-object reply that can hold
 * it and then stops.
 */
export function makeInspect({ world, loader, loop, files, bus, editor, view, log, reload, rewind }) {
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
    /**
     * Compact by default. Pass `{ entities: true, log: true, plugins: true }` for detail.
     *
     * `entities` may also name the fields to keep — `{ entities: ['id', 'at'] }` — and
     * the reply comes back as columns: the names once, then one array per entity. Same
     * world, a fifth of the reading.
     */
    snapshot(options = {}) {
      // `snapshot --entities id,at` reaches here as a string first argument, because
      // the flag parser keeps a bare flag boolean on purpose. Answering the compact
      // reply then reads as the projection having done nothing.
      if (typeof options !== 'object' || options === null) {
        throw new Error(`snapshot takes an options object — for some fields as columns: snapshot '{"entities":["id","at"]}'`)
      }
      const types = [...world.types.keys()]
      const broken = loader.failures()
      const out = {
        mode: loop.running ? 'play' : 'edit',
        // Which project answered. A command that omits `--project` opens the
        // default one and says nothing, so a reply about the wrong game reads
        // exactly like a reply about the right one.
        project: editor.projectName,
        level: editor.levelName,
        // Engine time and seed, because "what happened" is only reproducible
        // if you know where the clock and the random stream were.
        time: r(loop.time),
        // Only when something is holding time still. "Nothing is moving" is the
        // hardest thing to diagnose without being told who asked for that.
        ...(loop.paused ? { paused: loop.holds } : {}),
        seed: loop.random.seed,
        // One value that changes whenever the world does. Two runs are compared
        // by this rather than by reading a thousand entities: it is what answers
        // whether a change altered the simulation at all, and it is what makes a
        // rewind or a restored world checkable. See `stateHash` in world.js.
        hash: stateHash(world),
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
        // A refused write leaves nothing pending, so the count alone reads as
        // saved. Both halves are needed for `unsaved` to be true.
        unsaved: files.pending > 0 || !!files.refused,
        ...(files.refused ? { refused: files.refused.message } : {})
      }
      if (options.entities) {
        const rows = world.entities.map(e => entityView(e, true))
        out.entities = options.entities === true ? rows : asColumns(rows, wantedFields(options.entities, ENTITY_COLUMNS))
      }
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
     * quietly diverge. `fields` projects the rows the same way `snapshot` does, and
     * a session that only needs the ids should not pay for two hundred labels.
     */
    commands({ fields } = {}) {
      const rows = [
        ...loader.contrib.commands.map(c => ({ id: c.id, label: c.label, plugin: c.plugin })),
        ...loader.contrib.menus.map(m => ({ id: m.id, label: m.label, plugin: m.plugin, toolbar: true }))
      ]
      if (fields === undefined) return rows
      if (fields === true) throw new Error(`commands takes the fields as a value — commands '{"fields":["id"]}'`)
      return asColumns(rows, wantedFields(fields, ['id', 'label', 'plugin', 'toolbar']))
    },

    // Async, because a command handler may be. Both callers — the CLI and the
    // bridge — await the answer, so an async command reports what it measured
    // instead of a pending promise.
    async run(id, args) {
      const command = loader.contrib.commands.find(c => c.id === id)
        || loader.contrib.menus.find(m => m.id === id)
      if (!command) throw new Error(missingCommand(id, loader.failures()))
      validateCommandInput(command.inputSchema, args === undefined && command.inputSchema?.type === 'object' ? {} : args)
      const out = await command.run(editor.context, args)
      // A toolbar entry changes what is on screen, so redraw for it — a person
      // pressing the button gets that from the shell.
      if (command.toolbar !== false && loader.contrib.menus.includes(command)) editor.context.redraw()
      // A waiting note rides on a reply the agent is already reading, but only
      // on a plain object. A command answering with a number or a list answers
      // with exactly that; the note waits for the next reply that can hold it.
      return plainReply(out) ? note({ ...out }) : out
    },

    /** One entity in full, or null when no entity has that id. */
    entity(id) {
      const e = world.byId(id)
      return e ? entityView(e) : null
    },

    // ---- direct verbs, for driving without going through a command ----
    /** Select ids, as clicking them in the editor would. */
    select: ids => editor.select(ids),
    /** Enter play mode. A no-op when the world is already playing. */
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
      const before = loop.time
      loop.step(Math.round(seconds * 60))
      const snapshot = api.snapshot(options)
      // A hold runs the steps without advancing the world, so a caller that
      // reads only the reply cannot tell a simulated minute from a held one.
      const advanced = loop.time - before
      if (advanced < seconds - STEP_TOLERANCE) {
        snapshot.asked = seconds
        snapshot.advanced = Math.round(advanced * 1000) / 1000
        snapshot.heldBy = loop.holds
      }
      return snapshot
    },
    /** Spawn one entity and return its view, as a placement in the level would. */
    spawn: (type, placement) => entityView(editor.context.spawn(type, placement)),
    /** Destroy one entity by id. */
    destroy: id => editor.context.destroy(world.byId(id)),

    /**
     * Set a field or prop on an entity and persist it.
     *
     * Async because the save is: an unawaited save turns a refusal into an
     * unhandled rejection and answers the caller as if the file was written.
     * A save the editor skipped is named in the reply for the same reason.
     */
    async set(id, key, value) {
      const e = world.byId(id)
      if (!e) throw new Error(`no entity "${id}"`)
      if (key in e.properties) {
        e.properties[key] = value
        if (!e.overrides.includes(key)) e.overrides.push(key)
      } else e[key] = value
      bus.emit('world:changed')
      const saved = await editor.saveLevel()
      const view = entityView(e)
      return saved?.skipped ? { ...view, notSaved: saved.skipped } : view
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

    /** The last `n` log lines, oldest first. */
    log: (n = 40) => log.lines.slice(-n),
    /** Every error-level line in the ring. */
    errors: () => log.lines.filter(l => l.level === 'error'),
    /** Empty the log ring. */
    clearLog: () => { log.lines.length = 0 },

    // ---- going back through the run ----

    /**
     * The counts this run can be put back to, oldest first.
     *
     * Counts rather than moments: a moment is hundreds of kilobytes with a solver
     * in it, and what a caller wants to know is how far back it can go.
     */
    marks: () => ({ steps: loop.steps, stride: rewind.stride, depth: rewind.depth, oldest: rewind.oldest, marks: rewind.marks }),

    /**
     * Take a mark now.
     *
     * The ring marks on its own every `stride` steps. This is for the moment worth
     * returning to exactly — before a change whose effect is the question.
     */
    mark: () => ({ steps: rewind.mark(), marks: rewind.length }),

    /**
     * Step back `n` fixed steps, and say where the clock ended up.
     *
     * This is the verb the ring exists for: run the thing, look, come back. An
     * exact rewind, because the clock, the stream, the input record and every
     * plugin's own state come back with the entities.
     */
    stepBack: (count = 1) => rewind.back(count),

    /** Go back to a step count. Refused for a count the run has not reached. */
    seek: (steps = 0) => rewind.to(steps),

    // direct handles for anything the summary does not cover
    world, loader, loop, files, bus, editor, view,

    // Undefined when nothing is drawing, which is the honest answer rather than
    // a stub that pretends to render.
    get renderer() { return editor.context?.renderer },

    /**
     * What the last frame cost: draw calls, triangles, and whatever else the
     * renderer counts.
     *
     * An op rather than a field on `snapshot`, because measuring a rendering
     * change otherwise means driving `window.engine` through the browser.
     */
    renderStats() {
      const renderer = editor.context?.renderer
      if (!renderer) return { error: 'nothing is drawing — no renderer in this world' }
      const backend = renderer.backend
      // The optional features, named. A game may take a faster path when one is
      // there, so a terminal has to be able to see which it got.
      const optional = ['shader-f16', 'subgroups', 'float32-filterable', 'clip-distances',
        'dual-source-blending', 'timestamp-query', 'texture-compression-bc']
      return {
        ...renderer.stats,
        backend: backend && {
          name: backend.name,
          webgpu: backend.webgpu,
          features: optional.filter(backend.has)
        }
      }
    }
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
