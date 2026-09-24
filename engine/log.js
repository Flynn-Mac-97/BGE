/** Kernel: the process-wide error channels, and how a world's log reads them. */

/** How many lines a log keeps before the oldest is dropped. */
const RING = 200

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

  const uncaught = (error, at) =>
    reportToLogs('error', 'uncaught', error?.stack || error?.message || String(error), { at })
  const rejected = reason => reportToLogs('error', 'rejection', reason?.stack || reason?.message || String(reason))

  if (typeof addEventListener === 'function') {
    addEventListener('error', event =>
      uncaught(
        event.error || event.message,
        event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined
      )
    )
    addEventListener('unhandledrejection', event => rejected(event.reason))
  } else if (typeof process !== 'undefined' && typeof process.on === 'function') {
    process.on('uncaughtException', error => uncaught(error))
    process.on('unhandledRejection', reason => rejected(reason))
  }

  const original = console.error
  console.error = (...args) => {
    reportToLogs('error', 'console', args.map(a => a?.stack || a?.message || String(a)).join(' '))
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
/** What one hot swap did, in a few words. */
function hotAppliedNote(change) {
  if (change.removed) return 'removed'
  if (change.entities != null) return `→ ${change.entities} entities`
  return change.skipped || 'applied'
}

export function makeLog(bus) {
  const lines = []

  const push = (level, source, message, extra) => {
    lines.push({ t: Math.round(performance.now()), level, source, message, ...extra })
    if (lines.length > RING) lines.shift()
  }

  bus.on('plugin:error', failure =>
    push('error', failure.file ? 'plugin' : `plugin:${failure.name}`, reasonFor(failure))
  )
  bus.on('files:written', ({ path }) => push('info', 'files', `wrote ${path}`))
  // An error, not a note: a write that did not land is the one thing a reader
  // must not miss, and the reason names who is holding the file.
  bus.on('files:refused', ({ message }) => push('error', 'files', message))

  // "I wrote the file — did it take?" has to be answerable from the log, or an
  // agent has no way to tell a hot swap that worked from one that never ran.
  bus.on('hot:applied', change => push('info', 'hot', `${change.file} ${hotAppliedNote(change)}`))
  // A lost device is an error: without it the canvas stays blank and a reader
  // must be able to say why. The restore is a note, because drawing resumed.
  bus.on('device:lost', loss =>
    push(
      'error',
      'render',
      `the graphics device was lost — ${loss?.message || 'reason unknown'}; frames are skipped until it comes back`
    )
  )
  bus.on('device:restored', () =>
    push('info', 'render', 'the graphics device came back — kernel render targets rebuilt')
  )
  bus.on('hot:failed', c => push('error', 'hot', `${c.file} — ${c.error}`))

  const log = { lines, push }
  // This world is now one of the logs a process-wide error is reported to, and
  // the wiring is installed if this is the first world to ask.
  LOGS.add(new WeakRef(log))
  wireOnce()
  return log
}

/** One plugin failure in a sentence, for a log line or a snapshot. */
export const reasonFor = failure =>
  failure.file
    ? `${failure.file} failed to import — ${failure.error}. Every command it contributes is missing.`
    : `plugin "${failure.name}" failed to load — ${failure.error}. Every command it contributes is missing.`
