/**
 * Run Clock — a run has a shape: it starts, it is timed, and it ends.
 *
 * Without one, a game of this kind is an activity rather than a run. The clock
 * is the thing every survivor is really scored on, the death is the full stop,
 * and the number you lasted is the whole result. All three are the same small
 * piece of state, so they live in one place.
 *
 *   context.run.watch('you')                 end the run when this dies
 *   context.run.report('kills', () => n)     a number for the result
 *   context.bus.on('run:ended', ...)         draw whatever the game says
 *
 * It measures **engine** time, so a run paused for a level-up is not a run that
 * lasted longer. It ends by holding the world still, and leaves the words on
 * screen to the game — "you survived 12:34" is written in the game's voice, and
 * a builtin that wrote it would be writing one game's copy for every other.
 */

/** Why the world is stopped once the run is over, in a word a snapshot can print. */
const HOLD = 'run-over'

export default {
  name: 'Run Clock',
  about: 'Time a run, end it when the thing it watches dies, and hold the world when it is over.',
  inspect: context => {
    const run = context.run
    if (!run) return []
    return [{
      title: 'Run',
      rows: [['clock', run.clock], ['state', run.over ? `over — ${run.reason}` : run.running ? 'running' : 'not started']]
    }]
  },

  onLoad(context) {
    const state = { startedAt: 0, endedAt: 0, running: false, over: false, reason: null }
    /** Entity, id, or a function returning one. Its death ends the run. */
    let watched = null
    /** Extra numbers the game wants on the result, by name. */
    const reports = new Map()
    /** Seconds after which the run ends by itself. Zero means it never does. */
    let limit = 0

    const secondsNow = () =>
      state.over ? state.endedAt - state.startedAt : state.running ? context.time - state.startedAt : 0

    function publish() {
      context.world.state.runSeconds = Math.floor(secondsNow())
      context.world.state.runClock = asClock(secondsNow())
      context.world.state.runOver = state.over
    }

    function begin() {
      if (state.running || state.over) return { ok: false, reason: 'already begun' }
      state.startedAt = context.time
      state.running = true
      state.over = false
      state.reason = null
      publish()
      context.bus.emit('run:started', {})
      return { ok: true }
    }

    function end(reason = 'ended') {
      if (state.over) return { ok: false, reason: 'already over' }
      state.endedAt = context.time
      state.running = false
      state.over = true
      state.reason = reason
      publish()
      // The world stops so the result can be read. Held rather than stopped:
      // a stopped loop draws nothing, and a result nobody can see is not one.
      context.loop.hold(HOLD)
      context.bus.emit('run:ended', summary())
      return { ok: true, ...summary() }
    }

    function reset() {
      state.startedAt = 0
      state.endedAt = 0
      state.running = false
      state.over = false
      state.reason = null
      context.loop.release(HOLD)
      publish()
    }

    /** Everything a result screen needs, in one object. */
    function summary() {
      const out = {
        seconds: Math.floor(secondsNow()),
        clock: asClock(secondsNow()),
        reason: state.reason,
        over: state.over
      }
      for (const [name, read] of reports) {
        try { out[name] = read() } catch { out[name] = null }
      }
      return out
    }

    /** The thing whose death ends the run, resolved fresh so a respawn is followed. */
    function watching() {
      const named = typeof watched === 'function' ? watched() : watched
      const entity = typeof named === 'string' ? context.world.byId(named) : named
      return entity || null
    }

    context.run = {
      begin,
      end,
      reset,
      summary,

      /** End the run when this dies or leaves the world. */
      watch(who) { watched = who; return who },
      /** A number for the result card: `report('kills', () => count)`. */
      report(name, read) { reports.set(name, read); return name },
      /** End by itself after this many seconds. Zero means never. */
      limit(seconds) { limit = Number(seconds) || 0; return limit },

      get seconds() { return Math.floor(secondsNow()) },
      get clock() { return asClock(secondsNow()) },
      get running() { return state.running },
      get over() { return state.over },
      get reason() { return state.reason },
      get watching() { return watching() }
    }

    publish()
    context.bus.on('level:loaded', reset)

    /** Kept on the module so the system below reaches this world's own run. */
    runClock.tick = () => {
      if (state.over) return
      // Started by the first step rather than by `play:started`, so a headless
      // simulate() times a run exactly as pressing play does.
      if (!state.running) begin()
      publish()

      if (limit && secondsNow() >= limit) return void end('survived')

      if (watched == null) return
      const entity = watching()
      if (!entity || !context.world.entities.includes(entity)) return void end('died')
      const health = entity.properties?.health
      if (health != null && health <= 0) return void end('died')
    }
  },

  systems: [{
    // Fixed, because ending a run is a change to the game and must land on the
    // same step on every replay.
    phase: 'fixed',
    run: () => runClock.tick?.()
  }],

  commands: [
    { id: 'run.state', label: 'How the run is going', run: context => context.run.summary() },
    { id: 'run.end', label: 'End the run now', run: (context, args) => context.run.end([].concat(args ?? [])[0] || 'ended') }
  ]
}

/** The live run's tick, published so the declared system can reach it. */
export const runClock = { tick: null }

/** 12:34 — the only format a survivor's clock is ever read in. */
function asClock(seconds) {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}
