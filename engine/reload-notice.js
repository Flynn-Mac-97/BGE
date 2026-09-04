/**
 * Kernel: carry the world through a page reload, and say so either way.
 *
 * Editing anything under `engine/` or `plugins/` is a full page reload — Vite's
 * answer for source that cannot swap in place, and the right answer for the
 * editor itself. What is wrong is that the reload is silent. The page comes
 * back with a world rebuilt from the level file, so a simulated moment is gone,
 * and the next frame an agent takes shows a different world with nothing
 * anywhere saying why. The frame looks wrong, and the wrong thing gets debugged.
 *
 * Two promises are made here, and the second one holds even when the first
 * cannot:
 *
 *   the moment survives   what makes the moment — the level, every entity with
 *                         where it is and what it holds, shared game state, the
 *                         camera, the selection, whether play was running — is
 *                         written to sessionStorage before the page goes and put
 *                         back after it boots.
 *   the reload is said    the first `snapshot()` or `run()` after the page comes
 *                         back carries a plain sentence naming the file that
 *                         triggered it, when, and exactly what did and did not
 *                         come back. It is said once and then stops, so it
 *                         cannot haunt every later reply. `takeReloadNote` is
 *                         how the reading surface asks; this file pushes
 *                         nothing and wraps nothing.
 *
 * When a restore cannot be faithful the world is held still rather than handed
 * over as though it were. Entities a plugin spawned come back standing in the
 * right places, but the crowd or pool that drove them was rebuilt empty — so the
 * world looks exactly right and would run wrong, which is the failure the whole
 * of this is about. Time is held under a name that every later `snapshot()`
 * shows, so the lie cannot be told twice.
 *
 * The clock and the random stream come back with everything else. Both are
 * restored in the form the loop keeps them — a step count and a draw count, not
 * a rounded time and a seed — because a world standing where five seconds of
 * simulation left it while its clock reads zero is worse than an honest reset:
 * every reading taken afterwards is quietly wrong and nothing on the surface
 * says so.
 *
 * What still cannot come back is named in the notice rather than papered over.
 * Scheduled callbacks are closures and cannot be written down. State a plugin
 * holds outside the world is rebuilt from boot. A field holding something other
 * than data — a function, a texture, a class instance — is left behind and
 * reported by name. A restore that quietly loses state is worse than an honest
 * reset, so nothing here guesses.
 *
 * sessionStorage is the right lifetime by construction: it survives a reload
 * inside a tab and dies with the tab, so a moment can never outlive the session
 * that made it. Neither it nor `import.meta.hot` exists in node or in a
 * production build, and every use of both is guarded — the headless world runs
 * many at a time and must not pay a penny for a browser's problem.
 */

/** The shape written to storage. A capture from an older engine is discarded rather than guessed at. */
const CAPTURE_VERSION = 1

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

/** How deep a captured value may nest before it is treated as something other than data. */
const DATA_DEPTH = 8

/** Marks a value that is not plain data and so was left behind. */
const DROPPED = Symbol('dropped')

/** A captured reference to another entity, put back by id once the world is whole again. */
const ENTITY_REFERENCE = '#entity'

/**
 * The name time is held under when a restored world is safe to look at and not
 * safe to run.
 *
 * Short because it has to be typed to let go of it, and a name because
 * `snapshot().paused` lists holds by name — so every reading of the world, not
 * just the first one, says that this world is a moment rather than a run.
 */
const LOOK_ONLY = 'restored-world'

/**
 * Fields the capture handles itself, so the sweep for game-written fields skips
 * them. Everything else an entity carries is game state written at runtime and
 * is captured by value.
 */
const MODELLED = new Set([
  'id', 'type', 'x', 'y', 'z', 'rotation', 'scale', 'sprite', 'mesh', 'collider',
  'properties', 'overrides', 'hidden', 'behaviours',
  '_definition', '_detached', '_setByPlacement', '_extraKeys'
])

const round = n => Math.round(n * 1000) / 1000

const isPlainObject = value =>
  !!value && typeof value === 'object' && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)

/**
 * Copy a value if it is data, and say what it was if it is not.
 *
 * Only primitives, arrays and plain objects cross the boundary. A function, a
 * class instance, a Three object or a DOM node cannot be written to storage and
 * must not be replaced by a hollow copy that looks like the real thing, so it is
 * dropped and its name goes into the report.
 *
 * An entity is the exception worth making: a reference to one is kept as its id
 * and looked up again after the world is rebuilt, which is exact whenever the
 * entity it points at also came back.
 */
function asData(value, report, where, live, depth = 0) {
  if (value === null) return null
  // A field that is not there is not a loss. A 3D thing has no sprite and a 2D
  // thing has no mesh, and reporting either as something that could not be kept
  // would bury the fields that really were lost.
  if (value === undefined) return DROPPED
  const kind = typeof value
  if (kind === 'boolean' || kind === 'string') return value
  if (kind === 'number') {
    if (Number.isFinite(value)) return value
    report.push(`${where} (${String(value)})`)
    return DROPPED
  }
  if (kind !== 'object') {
    report.push(`${where} (a ${kind})`)
    return DROPPED
  }
  if (live?.has(value)) return { [ENTITY_REFERENCE]: value.id }
  if (depth >= DATA_DEPTH) {
    report.push(`${where} (nested deeper than ${DATA_DEPTH})`)
    return DROPPED
  }
  if (Array.isArray(value)) {
    const out = []
    for (let i = 0; i < value.length; i++) {
      const item = asData(value[i], report, `${where}[${i}]`, live, depth + 1)
      // One unusable element makes the whole list untrue, because a shorter list
      // is a different list. Drop it whole and say so.
      if (item === DROPPED) return DROPPED
      out.push(item)
    }
    return out
  }
  if (!isPlainObject(value)) {
    report.push(`${where} (a ${value.constructor?.name || 'thing that is not data'})`)
    return DROPPED
  }
  const out = {}
  for (const [key, item] of Object.entries(value)) {
    const copy = asData(item, report, `${where}.${key}`, live, depth + 1)
    if (copy !== DROPPED) out[key] = copy
  }
  return out
}

/** Put entity references back, now that the world holds the entities again. */
function fromData(value, world, missing, where) {
  if (!value || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((item, i) => fromData(item, world, missing, `${where}[${i}]`))
  if (typeof value[ENTITY_REFERENCE] === 'string') {
    const entity = world.byId(value[ENTITY_REFERENCE])
    if (entity) return entity
    missing.push(`${where} pointed at "${value[ENTITY_REFERENCE]}", which is not in the restored world`)
    return null
  }
  const out = {}
  for (const [key, item] of Object.entries(value)) out[key] = fromData(item, world, missing, `${where}.${key}`)
  return out
}

/**
 * Everything that makes this moment this moment.
 *
 * Written from the live world rather than from the level file, because the
 * entities worth keeping are the ones the level does not contain — what a
 * spawner made, where a chase ended up, what a behaviour is holding.
 *
 * Pure: it reads and copies, and touches no storage. That is what lets the whole
 * of it be proven in a headless world with no browser anywhere near it.
 */
export function captureWorld({ world, loop, editor, view }, cause = {}) {
  const dropped = []
  const live = new WeakSet(world.entities)

  const capture = {
    version: CAPTURE_VERSION,
    cause: {
      kind: cause.kind || 'reload',
      file: cause.file || null,
      at: cause.at || new Date().toISOString()
    },
    project: editor.projectName,
    level: editor.levelName,
    playing: !!loop.running,
    simulated: !!world.simulated,
    time: round(loop.time),
    // The clock in the form the loop actually keeps it, and the stream in the
    // form that can be rejoined. A time in seconds is a rounding and a seed
    // alone is only where a run began, so neither on its own would put the
    // world back in the run it was in.
    steps: loop.steps,
    seed: loop.random.seed,
    draws: loop.random.draws,
    // A count, not the timers themselves: a scheduled callback is a closure and
    // cannot be written down. Knowing how many were in flight is what makes the
    // loss reportable.
    timers: loop.timers.length,
    view: {
      x: view.x, y: view.y, z: view.z, zoom: view.zoom,
      mode: view.mode, yaw: view.yaw, pitch: view.pitch, fov: view.fov
    },
    selection: [...editor.selection],
    // Kept beside the entities rather than counted off them, so the notice can
    // still say how big the moment was on the path where the entities are the
    // thing that had to be dropped.
    entityCount: world.entities.length,
    // Which type names had a definition behind them at this moment. A plugin may
    // drive entities of a name no file declares — a projectile is one — so
    // "there is no type for this entity" is only a loss when there was one
    // before, and this is what makes the two cases tellable apart.
    types: [...world.types.keys()],
    state: asData(world.state, dropped, 'world.state', live),
    entities: world.entities.map(entity => {
      const named = new Set(entity.behaviours.map(b => b.name))
      const fields = {}
      for (const key of Object.keys(entity)) {
        if (MODELLED.has(key) || named.has(key)) continue
        const copy = asData(entity[key], dropped, `${entity.id}.${key}`, live)
        if (copy !== DROPPED) fields[key] = copy
      }
      const take = (value, where) => {
        const copy = asData(value, dropped, `${entity.id}.${where}`, live)
        return copy === DROPPED ? null : copy
      }
      return {
        id: entity.id,
        type: entity.type,
        at: [entity.x, entity.y, entity.z],
        rotation: entity.rotation,
        scale: entity.scale,
        hidden: !!entity.hidden,
        sprite: take(entity.sprite, 'sprite'),
        mesh: take(entity.mesh, 'mesh'),
        collider: take(entity.collider, 'collider'),
        properties: take(entity.properties, 'properties') || {},
        overrides: [...entity.overrides],
        setByPlacement: { ...entity._setByPlacement },
        detached: [...entity._detached],
        extra: take(entity._extraKeys, 'placement keys') || {},
        fields,
        behaviours: entity.behaviours.map(b => ({
          name: b.name,
          own: !!b.own,
          overrides: [...b.overrides],
          bag: take(b.bag, `${b.name}`) || {}
        }))
      }
    }),
    dropped
  }
  if (capture.state === DROPPED) capture.state = {}
  return capture
}

/**
 * Put a captured moment back into a freshly booted world.
 *
 * The level is opened first so types, behaviours and the camera baseline come
 * from the file, then every captured entity is placed on top of it — including
 * the ones no level contains. Live values are written after the spawn rather
 * than through it, because a placement's `properties` is also its override list
 * and handing it every value would turn a running world into a world that claims
 * to disagree with its own types about everything.
 *
 * Returns what came back and, more importantly, what did not.
 */
export async function restoreWorld(capture, { world, loop, editor, view, bus, context }) {
  const notRestored = []
  const missing = []

  if (capture.version !== CAPTURE_VERSION) throw new Error('the capture was written by a different engine')
  if (!capture.entities) throw new Error('the capture holds no entities')

  // Only when it is a different level. The boot has already opened one, and
  // reading a level in order to throw every entity in it away a line later is
  // work nobody asked for.
  if (capture.level && capture.level !== editor.levelName) await editor.loadLevel(capture.level)

  // Who the level itself accounts for. Everything else in the capture was made
  // while the run was going, and those are exactly the entities a plugin is
  // likely to be keeping its own list of.
  const fromLevel = new Set(world.entities.map(entity => entity.id))

  world.clear()

  for (const held of capture.entities) {
    const attached = placementBehaviours(held)
    const placement = {
      id: held.id,
      at: held.at,
      ...(held.rotation ? { rotation: held.rotation } : {}),
      ...(held.scale !== 1 ? { scale: held.scale } : {}),
      // The placement flags decide what a later type reload is allowed to
      // overwrite, so they are restored as flags and the live values are written
      // over the top afterwards.
      ...(held.setByPlacement?.sprite && held.sprite ? { sprite: held.sprite } : {}),
      ...(held.setByPlacement?.mesh && held.mesh ? { mesh: {} } : {}),
      ...(held.setByPlacement?.collider && held.collider ? { collider: held.collider } : {}),
      // Only the overrides whose value actually survived. An override naming a
      // key with nothing behind it would write `undefined` into the level on the
      // next save, which reads as a decision somebody made.
      properties: Object.fromEntries(held.overrides
        .filter(key => held.properties[key] !== undefined)
        .map(key => [key, held.properties[key]])),
      ...(attached ? { behaviours: attached } : {}),
      ...held.extra
    }

    const entity = world.spawn(held.type, placement)

    entity.x = held.at[0]
    entity.y = held.at[1]
    entity.z = held.at[2]
    entity.rotation = held.rotation
    entity.scale = held.scale
    entity.hidden = held.hidden
    // Restored rather than inferred from the placement above. An entity spawned
    // mid-run carried no id of its own, and giving it back through a placement
    // would add one — which the next save would then write into the level file
    // as though the author had put it there.
    entity._extraKeys = { ...held.extra }
    if (held.sprite) entity.sprite = held.sprite
    if (held.mesh) entity.mesh = held.mesh
    if (held.collider) entity.collider = held.collider
    // Assigned over the type's defaults rather than replacing them, so a value
    // that could not be captured keeps the file's answer instead of vanishing.
    Object.assign(entity.properties, fromData(held.properties, world, missing, `${held.id}.properties`))

    for (const [key, value] of Object.entries(held.fields)) {
      entity[key] = fromData(value, world, missing, `${held.id}.${key}`)
    }

    for (const bag of held.behaviours) {
      const record = entity.behaviours.find(b => b.name === bag.name)
      if (!record) {
        notRestored.push(`"${held.id}" lost its "${bag.name}" behaviour`)
        continue
      }
      Object.assign(record.bag, fromData(bag.bag, world, missing, `${held.id}.${bag.name}`))
    }
  }

  // Mutated rather than replaced: a plugin that took a reference to the shared
  // state at boot must still be looking at the same object.
  for (const key of Object.keys(world.state)) delete world.state[key]
  Object.assign(world.state, fromData(capture.state || {}, world, missing, 'world.state'))
  world.simulated = !!capture.simulated

  if (capture.playing && !loop.running) {
    // The plugins are told play started, because they booted a moment ago and
    // know nothing about it. The entities are not started again: they already
    // ran their start hooks in the page that went away, and running them twice
    // would reset the very state this restore exists to keep.
    bus.emit('play:started')
    loop.start()
  }

  // After everything that could draw from the stream or schedule a timer —
  // spawning an entity and starting play both reach plugins, and a plugin that
  // took a random number while the world was being rebuilt would leave the
  // stream a draw or two past where the run had it. This puts both back last, so
  // the clock and the stream end where the entities do.
  loop.resume({ steps: capture.steps ?? 0, seed: capture.seed, draws: capture.draws ?? 0 })

  // Last, because both play and the focus plugins move the camera when play
  // starts, and where the camera actually was is part of the moment.
  Object.assign(view, capture.view)
  editor.select(capture.selection || [])

  bus.emit('world:changed')
  // Said apart from `world:changed` because it means something that event does
  // not: these entities are back from a run that already happened, not placed
  // by a level. A plugin holding a list of what it spawned rebuilds it here, and
  // that is the only way such a list can come back — the kernel cannot know
  // which of its groups a restored entity belonged to.
  bus.emit('world:restored', { level: editor.levelName, entities: world.entities.length, capture })
  context?.redraw?.()

  notRestored.push(...missing)
  const lostTypes = (capture.types || []).filter(name => !world.types.has(name))
  if (lostTypes.length) notRestored.push(`the type${lostTypes.length === 1 ? '' : 's'} ${lostTypes.join(', ')}, whose file the project no longer has — entities of that name came back with no definition behind them`)
  // Claimed only when true. The clock and the stream are restored now, and a
  // notice that went on saying they were not would be the same silence in a
  // different voice.
  if (loop.steps !== (capture.steps ?? 0)) notRestored.push(`the clock, which was ${capture.time}s and is now ${round(loop.time)}s`)
  if (loop.random.seed !== capture.seed || loop.random.draws !== (capture.draws ?? 0)) {
    notRestored.push(`the random stream, which was ${capture.draws ?? 0} draws into seed ${capture.seed} and is now ${loop.random.draws} into seed ${loop.random.seed}`)
  }
  if (capture.timers) notRestored.push(`${capture.timers} scheduled ${capture.timers === 1 ? 'callback' : 'callbacks'}, which are closures and cannot be written down`)
  if (capture.dropped?.length) notRestored.push(`${capture.dropped.length} field${capture.dropped.length === 1 ? '' : 's'} that held something other than data: ${capture.dropped.slice(0, 8).join(', ')}`)

  // The vague half of this used to be the whole of it, and a vague loss is one
  // nobody acts on. The entities a plugin made are countable, so count them and
  // say what the consequence is.
  //
  // The consequence is the whole point. Those entities are back and standing in
  // the right places, so the world LOOKS exactly like the one that was lost —
  // and it will not run like it, because whatever list drove them was rebuilt
  // empty. A world that looks right and moves wrong is the failure this file
  // exists to end, so it is not merely reported: the loop is held, by name, and
  // nothing moves until somebody says it may.
  const madeInTheRun = capture.entities.filter(held => !fromLevel.has(held.id)).length
  if (madeInTheRun) {
    loop.hold(LOOK_ONLY)
    notRestored.push(
      `the lists plugins keep of what they spawned. ${madeInTheRun} of the ${capture.entities.length} entities were made during the run rather than by the level, and the crowd, pool or wave counter that drove them came back empty — so this world will not simulate the same as the one that was lost. `
      + `It is held still under the name "${LOOK_ONLY}" for that reason: look at it, and do not run it on. `
      + `engine.stop() gives you the level as authored; engine.loop.release("${LOOK_ONLY}") runs it anyway, knowing that`)
  } else {
    notRestored.push('anything a plugin holds outside the world, which was rebuilt from boot')
  }

  return {
    level: editor.levelName,
    entities: world.entities.length,
    simulated: world.simulated,
    playing: loop.running,
    lookOnly: loop.holds.includes(LOOK_ONLY),
    notRestored
  }
}

/** What this placement said about behaviours, in the form a level file writes. */
function placementBehaviours(held) {
  const out = {}
  for (const b of held.behaviours) {
    if (!b.own && !b.overrides.length) continue
    out[b.name] = Object.fromEntries(b.overrides.map(key => [key, b.bag[key]]))
  }
  for (const name of held.detached || []) out[name] = false
  const names = Object.keys(out)
  if (!names.length) return null
  return names.every(name => out[name] && !Object.keys(out[name]).length) ? names : out
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
  const file = capture.cause?.file
  const clock = String(capture.cause?.at || '').slice(11, 19)
  const trigger = file
    ? `a hot reload of ${file} reloaded the page`
    : 'the page reloaded'
  const when = clock ? ` at ${clock} UTC` : ''
  const held = capture.entityCount ?? capture.entities?.length ?? 0
  const detail = {
    file: file || null,
    at: capture.cause?.at || null,
    cause: capture.cause?.kind || 'reload',
    from: {
      level: capture.level,
      entities: held,
      simulated: !!capture.simulated,
      playing: !!capture.playing,
      time: capture.time ?? null,
      seed: capture.seed ?? null
    },
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
    const was = `level "${outcome.restored.level}", ${outcome.restored.entities} ${outcome.restored.entities === 1 ? 'entity' : 'entities'}`
        + `${outcome.restored.simulated ? ', simulated' : ''}${outcome.restored.playing ? ', playing' : ''}`
    return {
      key: 'worldWasRestored',
      // Two different claims, because they are two different worlds to be
      // handed. One can be run on and the other cannot, and saying "restored"
      // for both would make the word worthless.
      sentence: (outcome.restored.lookOnly
        ? `${trigger}${when}; the world was put back to LOOK at, not to run on — ${was}, and time is held still. `
        : `${trigger}${when}; the world was put back as it was — ${was}. `)
        + `A restore is never bit-identical to a live simulation, so re-simulate if you need exactness. `
        + `NOT restored: ${outcome.restored.notRestored.join('; ')}. `
        + (outcome.restored.lookOnly
          ? 'engine.reloadNotice() repeats this.'
          : 'engine.reloadNotice() repeats this; engine.stop() goes back to the level as authored.'),
      detail
    }
  }

  if (outcome.unchanged) {
    return {
      key: 'worldWasReset',
      sentence: `${trigger}${when}; the world was rebuilt from level "${capture.level}" and nothing was lost — `
        + `it had not been simulated and held only what the level holds. engine.reloadNotice() repeats this.`,
      detail
    }
  }

  detail.notRestored = outcome.notRestored || []
  return {
    key: 'worldWasReset',
    sentence: `${trigger}${when}; the world was rebuilt from the level and your simulated moment is gone`
      + `${outcome.why ? ` (${outcome.why})` : ''}. `
      + (capture.level
        ? `It was level "${capture.level}", ${held} ${held === 1 ? 'entity' : 'entities'} at ${capture.time ?? 0}s`
          + `${capture.simulated ? ', simulated' : ''}. `
        : '')
      + `Re-simulate before you look again. engine.reloadNotice() repeats this.`,
    detail
  }
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
        store.setItem(STORAGE_KEY, JSON.stringify({
          version: CAPTURE_VERSION, cause, project: parts.editor.projectName,
          level: parts.editor.levelName, entityCount: parts.world.entities.length,
          simulated: !!parts.world.simulated,
          time: round(parts.loop.time), seed: parts.loop.random.seed,
          entities: null, failed: String(error?.message || error)
        }))
      } catch { /* a tab that cannot write cannot be helped */ }
    }
  }

  const hot = import.meta.hot
  if (hot) {
    hot.on('vite:beforeFullReload', payload => save({
      kind: 'vite full reload',
      file: shortenPath(payload?.triggeredBy || payload?.path),
      at: new Date().toISOString()
    }))
  }

  // The reload the editor asks for itself, named by whoever asked for it. Live
  // File Updates says this before it calls `location.reload()`, so the cause is
  // carried rather than inferred.
  parts.bus?.on?.('reload:before', ({ file, why } = {}) => save({
    kind: why || 'the editor reloaded the page',
    file: shortenPath(file),
    at: new Date().toISOString()
  }))

  // Everything else that takes the page: a person pressing reload, a dev server
  // restarting, a tab being closed. There is no file to name and guessing one
  // would be worse than saying nothing, because a wrong name is acted on.
  window.addEventListener('pagehide', () => save({ kind: 'page unload', file: null, at: new Date().toISOString() }))
}

/** Is the world the page just booted already the world that was captured? */
function sameMoment(capture, fresh) {
  return !capture.simulated && !capture.playing
    && capture.level === fresh.level
    && JSON.stringify(capture.entities) === JSON.stringify(fresh.entities)
    && JSON.stringify(capture.state) === JSON.stringify(fresh.state)
    && JSON.stringify(capture.selection) === JSON.stringify(fresh.selection)
    && JSON.stringify(capture.view) === JSON.stringify(fresh.view)
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

  let text = null
  try { text = store.getItem(STORAGE_KEY) } catch { return null }
  if (!text) return null
  // Removed before it is used, not after: a capture that survived being applied
  // once would be applied again by the next reload, over a world it does not
  // describe.
  try { store.removeItem(STORAGE_KEY) } catch { /* nothing to do about it */ }

  let capture = null
  try { capture = JSON.parse(text) } catch { /* the guard below is the one answer */ }
  // A moment this engine cannot read is still a reload, and a reload nobody
  // mentions is the whole problem this file exists to end.
  if (!capture || capture.version !== CAPTURE_VERSION) {
    const notice = describeReload(capture || {}, {
      why: capture ? 'the moment was written by a different version of the engine' : 'the moment could not be read back'
    })
    announce(notice)
    return notice
  }
  if (capture.project && capture.project !== parts.editor.projectName) {
    const notice = describeReload(capture, {
      why: `the moment belonged to project "${capture.project}" and this page serves "${parts.editor.projectName}"`
    })
    announce(notice)
    return notice
  }

  let notice = null
  if (!capture.entities) {
    notice = describeReload(capture, {
      why: capture.tooLarge
        ? `the moment was ${capture.tooLarge} characters, larger than a session will hold`
        : capture.failed || 'the moment could not be written down before the page went'
    })
  } else if (sameMoment(capture, captureWorld(parts, capture.cause))) {
    notice = describeReload(capture, { unchanged: true })
  } else {
    try {
      notice = describeReload(capture, { restored: await restoreWorld(capture, parts) })
    } catch (error) {
      // A half-restored world is worse than a rebuilt one. Go back to the level
      // and report the reason rather than leaving something in between.
      try { await parts.editor.loadLevel(parts.editor.levelName) } catch { /* the boot already tried */ }
      notice = describeReload(capture, { why: `putting it back failed — ${error?.message || error}` })
    }
  }

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
