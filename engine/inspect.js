/**
 * Kernel: the command surface, and the read-and-drive seam.
 *
 * Everything the editor can do is a command, so `engine.run(id, args)` is a
 * complete way to drive it. What `engine.snapshot()` returns is projected in
 * `snapshot.js`, and the world's log is wired in `log.js`; this file is the
 * surface those two meet at.
 *
 * Exposed as window.engine so an agent driving the browser can inspect state
 * and act without screenshots.
 */
import { validateCommandInput } from './command-schema.js'
import { round3 } from './round3.js'
import { makeLog, reasonFor } from './log.js'
import { asColumns, entityView, note, plainReply, projectSnapshot, wantedFields } from './snapshot.js'

export { makeLog } from './log.js'

/** Half a fixed step. Below this, a simulation ran the time it was asked for. */
const STEP_TOLERANCE = 1 / 120

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
  // A log made here started after the plugins did, so it heard none of what
  // they raised. Read that back out of the loader. A log passed in was already
  // listening and has it all, in the order it happened.
  const listenedFromTheStart = log != null
  const activeLog = log ?? makeLog(bus)
  if (!listenedFromTheStart) {
    for (const failure of loader.failures()) activeLog.push('error', 'plugin', reasonFor(failure))
  }

  /** Change one field or prop on an entity in the running world, and say the world changed. */
  const changeEntity = (id, key, value) => {
    const entity = world.byId(id)
    if (!entity) throw new Error(`no entity "${id}"`)
    if (key in entity.properties) {
      entity.properties[key] = value
      if (!entity.overrides.includes(key)) entity.overrides.push(key)
    } else entity[key] = value
    bus.emit('world:changed')
    return entity
  }

  const api = {
    snapshot(options = {}) {
      return projectSnapshot({ world, loader, loop, files, editor, view, log: activeLog, reload }, options)
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
        ...loader.contributions.commands.map(command => ({
          id: command.id,
          label: command.label,
          plugin: command.plugin
        })),
        ...loader.contributions.menus.map(menu => ({
          id: menu.id,
          label: menu.label,
          plugin: menu.plugin,
          toolbar: true
        }))
      ]
      if (fields === undefined) return rows
      if (fields === true) throw new Error(`commands takes the fields as a value — commands '{"fields":["id"]}'`)
      return asColumns(rows, wantedFields(fields, ['id', 'label', 'plugin', 'toolbar']))
    },

    // Async, because a command handler may be. Both callers — the CLI and the
    // bridge — await the answer, so an async command reports what it measured
    // instead of a pending promise.
    async run(id, args) {
      const command =
        loader.contributions.commands.find(candidate => candidate.id === id) ||
        loader.contributions.menus.find(menu => menu.id === id)
      if (!command) throw new Error(missingCommand(id, loader.failures()))
      validateCommandInput(
        command.inputSchema,
        args === undefined && command.inputSchema?.type === 'object' ? {} : args
      )
      const out = await command.run(editor.context, args)
      // A toolbar entry changes what is on screen, so redraw for it — a person
      // pressing the button gets that from the shell.
      if (command.toolbar !== false && loader.contributions.menus.includes(command)) editor.context.redraw()
      // A waiting note rides on a reply the agent is already reading, but only
      // on a plain object. A command answering with a number or a list answers
      // with exactly that; the note waits for the next reply that can hold it.
      return plainReply(out) ? note(reload, { ...out }) : out
    },

    /** One entity in full, or null when no entity has that id. */
    entity(id) {
      const entity = world.byId(id)
      return entity ? entityView(entity) : null
    },

    // ---- direct verbs, for driving without going through a command ----
    /** Select ids, as clicking them in the editor would. */
    select: ids => editor.select(ids),
    /** Enter play mode. A no-op when the world is already playing. */
    play: () => {
      if (!loop.running) editor.togglePlay()
    },

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
        for (const entity of [...world.entities]) world.hook(entity, 'start', editor.context)
      }
      const before = loop.time
      loop.step(Math.round(seconds * 60))
      const snapshot = api.snapshot(options)
      // A hold runs the steps without advancing the world, so a caller that
      // reads only the reply cannot tell a simulated minute from a held one.
      const advanced = loop.time - before
      if (advanced < seconds - STEP_TOLERANCE) {
        snapshot.asked = seconds
        snapshot.advanced = round3(advanced)
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
      const entity = changeEntity(id, key, value)
      const saved = await editor.saveLevel()
      const savedView = entityView(entity)
      return saved?.skipped ? { ...savedView, notSaved: saved.skipped } : savedView
    },

    /**
     * Set a field or prop on an entity in the running world only, never saved.
     *
     * For posing a moment to look at, as a lane does: it writes no file, so the
     * work lock lets it through where `set` is held.
     */
    setLive(id, key, value) {
      return entityView(changeEntity(id, key, value))
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

    /** The last `count` log lines, oldest first. */
    log: (count = 40) => activeLog.lines.slice(-count),
    /** Every error-level line in the ring. */
    errors: () => activeLog.lines.filter(line => line.level === 'error'),
    /** Empty the log ring. */
    clearLog: () => {
      activeLog.lines.length = 0
    },

    // ---- going back through the run ----

    /**
     * The counts this run can be put back to, oldest first.
     *
     * Counts rather than moments: a moment is hundreds of kilobytes with a solver
     * in it, and what a caller wants to know is how far back it can go.
     */
    marks: () => ({
      steps: loop.steps,
      stride: rewind.stride,
      depth: rewind.depth,
      oldest: rewind.oldest,
      marks: rewind.marks
    }),

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
    world,
    loader,
    loop,
    files,
    bus,
    editor,
    view,

    // Undefined when nothing is drawing, which is the honest answer rather than
    // a stub that pretends to render.
    get renderer() {
      return editor.context?.renderer
    },

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
      const optional = [
        'shader-f16',
        'subgroups',
        'float32-filterable',
        'clip-distances',
        'dual-source-blending',
        'timestamp-query',
        'texture-compression-bc'
      ]
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
  const why = failures
    .map(failure =>
      failure.file
        ? `Plugin file ${failure.file} failed to import: ${failure.error}.`
        : `Plugin "${failure.name}" failed to load: ${failure.error}.`
    )
    .join(' ')
  return (
    `no command "${id}". ${why} Every command those plugins contribute is missing, ` +
    `which may be this one. Try engine.commands()`
  )
}
