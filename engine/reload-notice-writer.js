/**
 * Kernel: the notice that a page reloaded — written before it goes, offered once after.
 *
 * Vite announces its own reload and does not await anything, so the moment is
 * written to sessionStorage synchronously before the page goes, and an unload
 * hook backs up the reload the editor asks for itself. sessionStorage is the
 * right lifetime by construction: it survives a reload inside a tab and dies
 * with the tab, so a moment can never outlive the session that made it. Neither
 * it nor import.meta.hot exists in node or in a production build, and every use
 * of both is guarded — the headless world runs many at a time and must not pay a
 * penny for a browser's problem.
 *
 * The reload is then said: the first snapshot() or run() after the page comes
 * back carries a plain sentence naming the file that triggered it, when, and
 * exactly what did and did not come back. It is said once and then stops, so it
 * cannot haunt every later reply. takeReloadNote is how the reading surface
 * asks; this file pushes nothing and wraps nothing.
 *
 * reload-projection.js turns the world into data and back; this file writes
 * that data to storage and writes the sentence. reload-notice.js re-exports
 * both.
 */
import { round3 } from './round3.js'
import { captureWorld, restoreWorld, CAPTURE_VERSION } from './reload-projection.js'

/** One key, so a stale capture can never accumulate. Read once, then removed. */
const STORAGE_KEY = 'engine:reload-capture'

/**
 * How much of a capture sessionStorage will take.
 *
 * Quotas are around five megabytes of UTF-16. A large level with everything it
 * spawned can approach that, and a write that throws on quota would lose the
 * notice as well as the moment. Over this size the entities are dropped and the
 * reason is carried instead, so the reload is still announced.
 */
const STORAGE_LIMIT = 3_000_000

/**
 * What caused the reload, in the words the sentence opens with.
 *
 * The instant is kept whole for the detail record and clipped to the clock for
 * the sentence, so both readings come from one place.
 */
function reloadCause(capture) {
  const file = capture.cause?.file
  const at = capture.cause?.at || null
  const clock = String(at || '').slice(11, 19)
  return {
    file: file || null,
    at,
    trigger: file ? `a hot reload of ${file} reloaded the page` : 'the page reloaded',
    when: clock ? ` at ${clock} UTC` : ''
  }
}

/** What the page held when it went, in the shape the notice reports. */
function reloadFrom(capture) {
  return {
    level: capture.level,
    entities: capture.entityCount ?? capture.entities?.length ?? 0,
    simulated: !!capture.simulated,
    playing: !!capture.playing,
    time: capture.time ?? null,
    seed: capture.seed ?? null
  }
}

/**
 * The sentence for a world that came back.
 *
 * Two different claims, because they are two different worlds to be handed.
 * One can be run on and the other cannot, and saying "restored" for both would
 * make the word worthless.
 */
function restoredSentence(reload, restored) {
  const was =
    `level "${restored.level}", ${restored.entities} ${restored.entities === 1 ? 'entity' : 'entities'}` +
    `${restored.simulated ? ', simulated' : ''}${restored.playing ? ', playing' : ''}`
  const opening = restored.lookOnly
    ? `${reload.trigger}${reload.when}; the world was put back to LOOK at, not to run on — ${was}, and time is held still. `
    : `${reload.trigger}${reload.when}; the world was put back as it was — ${was}. `
  const closing = restored.lookOnly
    ? 'engine.reloadNotice() repeats this.'
    : 'engine.reloadNotice() repeats this; engine.stop() goes back to the level as authored.'
  return (
    opening +
    'A restore is never bit-identical to a live simulation, so re-simulate if you need exactness. ' +
    `NOT restored: ${restored.notRestored.join('; ')}. ` +
    closing
  )
}

/** The sentence for a world rebuilt from the level with nothing lost. */
function unchangedSentence(reload, capture) {
  return (
    `${reload.trigger}${reload.when}; the world was rebuilt from level "${capture.level}" and nothing was lost — ` +
    'it had not been simulated and held only what the level holds. engine.reloadNotice() repeats this.'
  )
}

/** The sentence for a world rebuilt from the level, with the simulated moment gone. */
function resetSentence(reload, capture, from, outcome) {
  const moment = capture.level
    ? `It was level "${capture.level}", ${from.entities} ${from.entities === 1 ? 'entity' : 'entities'} at ${capture.time ?? 0}s` +
      `${capture.simulated ? ', simulated' : ''}. `
    : ''
  return (
    `${reload.trigger}${reload.when}; the world was rebuilt from the level and your simulated moment is gone` +
    `${outcome.why ? ` (${outcome.why})` : ''}. ` +
    moment +
    'Re-simulate before you look again. engine.reloadNotice() repeats this.'
  )
}

/**
 * The reload, in one sentence a person or an agent reads the same way.
 *
 * Plain words and no jargon, because the whole point is that it cannot be
 * mistaken for anything else. The key names the outcome: a world that came back
 * and a world that was rebuilt are different situations and must not share a
 * name.
 */
export function describeReload(capture, outcome) {
  const reload = reloadCause(capture)
  const from = reloadFrom(capture)
  const detail = {
    file: reload.file,
    at: reload.at,
    cause: capture.cause?.kind || 'reload',
    from,
    restored: null,
    notRestored: []
  }

  if (outcome.restored) {
    detail.restored = {
      level: outcome.restored.level,
      entities: outcome.restored.entities,
      simulated: outcome.restored.simulated,
      playing: outcome.restored.playing,
      lookOnly: !!outcome.restored.lookOnly
    }
    detail.notRestored = outcome.restored.notRestored
    return { key: 'worldWasRestored', sentence: restoredSentence(reload, outcome.restored), detail }
  }

  if (outcome.unchanged) {
    return { key: 'worldWasReset', sentence: unchangedSentence(reload, capture), detail }
  }

  detail.notRestored = outcome.notRestored || []
  return { key: 'worldWasReset', sentence: resetSentence(reload, capture, from, outcome), detail }
}

// ------------------------------------------------------------------ delivery

/**
 * The notice waiting to be handed over.
 *
 * Module state, and that is exactly its scope: a page has one world, and a node
 * process never sets this because nothing there has a session to restore from.
 *
 * It is offered rather than pushed. `engine.snapshot()` and `engine.run()` ask
 * for it through `takeReloadNote`, which answers once and then answers nothing —
 * so an agent running one command after the reload is certain to be told, and
 * the twentieth is not told again.
 */
let pending = null
let lastNotice = null

/**
 * The notice, once. The reading surface calls this; nothing else should.
 *
 * Say it once and stop, because a warning repeated on every reply is a warning
 * an agent learns to skip past, and the one that mattered is then the one that
 * got skipped.
 */
export function takeReloadNote() {
  if (!pending) return null
  const notice = pending
  pending = null
  return notice
}

/** The same notice, as many times as asked, for an agent that missed the once. */
export function lastReloadNotice() {
  return lastNotice
}

// ------------------------------------------------------------------ the tab

/**
 * sessionStorage, if there is one. There is not, in node or in a hostile tab.
 *
 * A tab is required as well as the storage. Node has begun shipping a web
 * storage of its own behind a flag, and a headless world must not start reading
 * a moment out of it — many of them run in one process and they would be reading
 * each other's.
 */
function sessionStore() {
  try {
    if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') return null
    return sessionStorage
  } catch {
    // A tab with storage blocked is a tab that cannot keep a moment. Say nothing
    // and let the world boot as it always did.
    return null
  }
}

/**
 * The file behind the reload, short enough to read.
 *
 * Vite names it as an absolute path on this machine, which tells an agent
 * nothing it can act on. What it can act on is the path inside the checkout.
 */
function shortenPath(file) {
  if (!file || file === '*') return null
  const path = String(file).split('\\').join('/')
  // Already relative to the checkout, so it is already the answer. Trimming it
  // further would throw away the project directory, which is the half that says
  // which game a plugin belongs to.
  if (!path.startsWith('/') && !/^[a-zA-Z]:/.test(path)) return path
  for (const directory of ['/plugins/', '/engine/', '/bin/', '/test/']) {
    const cut = path.lastIndexOf(directory)
    if (cut >= 0) return path.slice(cut + 1)
  }
  return path.split('/').filter(Boolean).slice(-2).join('/')
}

/**
 * Write the moment down before the page goes.
 *
 * Vite announces its own reload, and `vite:beforeFullReload` is fired without
 * being awaited — the write has to be synchronous or the page is gone before it
 * lands. The Live File Updates plugin reloads the page itself when a project
 * plugin changes, and Vite says nothing about that one, so an unload hook backs
 * it up. Whichever fires first wins, because the one that names the file is
 * worth more than the one that does not.
 */
function armCapture(parts, store) {
  if (typeof window === 'undefined' || !store) return
  let saved = false

  const save = cause => {
    if (saved) return
    saved = true
    try {
      const capture = captureWorld(parts, cause)
      let text = JSON.stringify(capture)
      if (text.length > STORAGE_LIMIT) {
        text = JSON.stringify({ ...capture, entities: null, tooLarge: text.length })
      }
      store.setItem(STORAGE_KEY, text)
    } catch (error) {
      // The moment is lost, but the reload must still be announced, so keep the
      // smallest thing that can announce it.
      try {
        store.setItem(
          STORAGE_KEY,
          JSON.stringify({
            version: CAPTURE_VERSION,
            cause,
            project: parts.editor.projectName,
            level: parts.editor.levelName,
            entityCount: parts.world.entities.length,
            simulated: !!parts.world.simulated,
            time: round3(parts.loop.time),
            seed: parts.loop.random.seed,
            entities: null,
            failed: String(error?.message || error)
          })
        )
      } catch {
        /* a tab that cannot write cannot be helped */
      }
    }
  }

  const hot = import.meta.hot
  if (hot) {
    hot.on('vite:beforeFullReload', payload =>
      save({
        kind: 'vite full reload',
        file: shortenPath(payload?.triggeredBy || payload?.path),
        at: new Date().toISOString()
      })
    )
  }

  // The reload the editor asks for itself, named by whoever asked for it. Live
  // File Updates says this before it calls `location.reload()`, so the cause is
  // carried rather than inferred.
  parts.bus?.on?.('reload:before', ({ file, why } = {}) =>
    save({
      kind: why || 'the editor reloaded the page',
      file: shortenPath(file),
      at: new Date().toISOString()
    })
  )

  // Everything else that takes the page: a person pressing reload, a dev server
  // restarting, a tab being closed. There is no file to name and guessing one
  // would be worse than saying nothing, because a wrong name is acted on.
  window.addEventListener('pagehide', () => save({ kind: 'page unload', file: null, at: new Date().toISOString() }))
}

/** Is the world the page just booted already the world that was captured? */
function sameMoment(capture, fresh) {
  return (
    !capture.simulated &&
    !capture.playing &&
    capture.level === fresh.level &&
    JSON.stringify(capture.entities) === JSON.stringify(fresh.entities) &&
    JSON.stringify(capture.state) === JSON.stringify(fresh.state) &&
    JSON.stringify(capture.selection) === JSON.stringify(fresh.selection) &&
    JSON.stringify(capture.view) === JSON.stringify(fresh.view)
  )
}

/**
 * Read the stored moment and remove it from storage.
 *
 * Removed before it is used, not after: a capture that survived being applied
 * once would be applied again by the next reload, over a world it does not
 * describe. `present` says whether there was anything to read at all, and
 * `capture` is null when the text could not be parsed.
 */
function takeCapture(store) {
  let text
  try {
    text = store.getItem(STORAGE_KEY)
  } catch {
    return { present: false, capture: null }
  }
  if (!text) return { present: false, capture: null }
  try {
    store.removeItem(STORAGE_KEY)
  } catch {
    /* nothing to do about it */
  }
  try {
    return { present: true, capture: JSON.parse(text) }
  } catch {
    return { present: true, capture: null }
  }
}

/**
 * Why a moment could not be read.
 *
 * A moment this engine cannot read is still a reload, and a reload nobody
 * mentions is the whole problem this file exists to end.
 */
function unreadableReason(capture) {
  return capture ? 'the moment was written by a different version of the engine' : 'the moment could not be read back'
}

/** Why this page will not take a moment written for another project. */
function wrongProjectReason(capture, parts) {
  return `the moment belonged to project "${capture.project}" and this page serves "${parts.editor.projectName}"`
}

/** Why a capture with no entities cannot be put back. */
function lostReason(capture) {
  if (capture.tooLarge) return `the moment was ${capture.tooLarge} characters, larger than a session will hold`
  return capture.failed || 'the moment could not be written down before the page went'
}

/** Put the entities back, or say why they could not be. */
async function restoreNotice(capture, parts) {
  if (!capture.entities) return describeReload(capture, { why: lostReason(capture) })
  if (sameMoment(capture, captureWorld(parts, capture.cause))) return describeReload(capture, { unchanged: true })
  try {
    return describeReload(capture, { restored: await restoreWorld(capture, parts) })
  } catch (error) {
    // A half-restored world is worse than a rebuilt one. Go back to the level
    // and report the reason rather than leaving something in between.
    try {
      await parts.editor.loadLevel(parts.editor.levelName)
    } catch {
      /* the boot already tried */
    }
    return describeReload(capture, { why: `putting it back failed — ${error?.message || error}` })
  }
}

/** The sentence for one capture: unreadable, another project, or restored. */
async function noticeFor(capture, parts) {
  if (!capture || capture.version !== CAPTURE_VERSION) {
    return describeReload(capture || {}, { why: unreadableReason(capture) })
  }
  if (capture.project && capture.project !== parts.editor.projectName) {
    return describeReload(capture, { why: wrongProjectReason(capture, parts) })
  }
  return restoreNotice(capture, parts)
}

/**
 * The whole of it, in one call from the boot path.
 *
 * Put back whatever the last page left behind, say what happened on the first
 * question anybody asks, and arm the next reload. A world with no session — every
 * headless world, and there are many of them at once — falls straight through
 * and is charged one function call for the privilege.
 */
export async function carryWorldThroughReload(parts) {
  const { engine } = parts
  const store = parts.store ?? sessionStore()

  // Always answerable, so an agent that missed the one-shot note has somewhere
  // to look rather than a guess.
  if (engine) engine.reloadNotice = lastReloadNotice

  armCapture(parts, store)
  if (!store) return null

  const taken = takeCapture(store)
  if (!taken.present) return null

  const notice = await noticeFor(taken.capture, parts)
  announce(notice)
  return notice
}

/**
 * Say it twice on purpose.
 *
 * Once into the log, which keeps it as history that `snapshot().errors` shows
 * for as long as it is recent; and once as the pending note, which the next
 * `snapshot()` or `run()` takes and nothing takes again. History answers "what
 * happened here"; the note answers "read this before you act".
 */
function announce(notice) {
  pending = notice
  lastNotice = notice
  console.error(`[reload] ${notice.sentence}`)
}
