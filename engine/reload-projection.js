/**
 * Kernel: a live world written as plain data, and put back.
 *
 * Only primitives, arrays and plain objects cross: a function, a texture or a
 * class instance cannot be written to storage and must not be replaced by a
 * hollow copy, so it is left behind and its name is reported. An entity
 * reference is kept as its id and looked up again once the world is whole.
 *
 * When a restore cannot be faithful the world is held still rather than handed
 * over as though it were. Entities a plugin spawned come back standing in the
 * right places, but the crowd or pool that drove them was rebuilt empty — so the
 * world looks exactly right and would run wrong, which is the failure this
 * projection is about. Time is held under a name that every later snapshot()
 * shows, so the lie cannot be told twice.
 *
 * The clock and the random stream come back with everything else. Both are
 * restored in the form the loop keeps them — a step count and a draw count, not
 * a rounded time and a seed — because a world standing where five seconds of
 * simulation left it while its clock reads zero is worse than an honest reset:
 * every reading taken afterwards is quietly wrong and nothing on the surface
 * says so.
 *
 * What still cannot come back is named in notRestored rather than papered over.
 * Scheduled callbacks are closures and cannot be written down. State a plugin
 * holds outside the world is rebuilt from boot. Nothing here guesses.
 *
 * The walk over a single value is shared with the checkpoint projection in
 * world-state.js; what differs is the policy, stated below. A checkpoint keeps
 * Set and Map because a solver's bytes never leave memory, while this one drops
 * whatever JSON cannot hold because sessionStorage is text.
 */
import { makeValueProjection, LOST } from './value-projection.js'
import { round3 } from './round3.js'

/** The shape written to storage. A capture from an older engine is discarded rather than guessed at. */
export const CAPTURE_VERSION = 1

/** How deep a captured value may nest before it is treated as something other than data. */
const DATA_DEPTH = 8

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

/**
 * What the sessionStorage projection drops.
 *
 * JSON holds primitives, arrays and plain objects and nothing else, so a Set, a
 * Map, a function, a symbol, a bigint and the non-finite numbers all go, and a
 * whole array goes with one unusable element because a shorter array is a
 * different array. A field that is not there is not a loss, so `undefined` is
 * dropped without being named.
 */
const { project, resolve } = makeValueProjection({
  maxDepth: DATA_DEPTH,
  keepContainers: false,
  keepLostKeys: false,
  loseWholeArray: true,
  keepUndefined: false,
  keepNonFinite: false,
  keepOtherPrimitives: false,
  entityTag: ENTITY_REFERENCE,
  report(lost, loss) {
    if (loss.reason === 'number') lost.push(`${loss.where} (${String(loss.value)})`)
    else if (loss.reason === 'kind') lost.push(`${loss.where} (a ${loss.kind})`)
    else if (loss.reason === 'function') lost.push(`${loss.where} (a function)`)
    else if (loss.reason === 'deep') lost.push(`${loss.where} (nested deeper than ${loss.maxDepth})`)
    else if (loss.reason === 'notPlain') lost.push(`${loss.where} (a ${loss.name || 'thing that is not data'})`)
  }
})

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
    time: round3(loop.time),
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
    state: project(world.state, live, dropped, 'world.state'),
    entities: world.entities.map(entity => {
      const named = new Set(entity.behaviours.map(b => b.name))
      const fields = {}
      for (const key of Object.keys(entity)) {
        if (MODELLED.has(key) || named.has(key)) continue
        const copy = project(entity[key], live, dropped, `${entity.id}.${key}`)
        if (copy !== LOST) fields[key] = copy
      }
      const take = (value, where) => {
        const copy = project(value, live, dropped, `${entity.id}.${where}`)
        return copy === LOST ? null : copy
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
  if (capture.state === LOST) capture.state = {}
  return capture
}

/** Every captured entity placed back into the cleared world, live values on top. */
function spawnCapturedEntities(capture, world, missing, notRestored) {
  for (const held of capture.entities) {
    const entity = world.spawn(held.type, placementOf(held))
    applyLiveValues(entity, held, world, missing)
    for (const bag of held.behaviours) {
      const record = entity.behaviours.find(behaviour => behaviour.name === bag.name)
      if (!record) {
        notRestored.push(`"${held.id}" lost its "${bag.name}" behaviour`)
        continue
      }
      Object.assign(record.bag, readField(bag.bag, world, missing, `${held.id}.${bag.name}`))
    }
  }
}

/**
 * Put the world's shared state back.
 *
 * Mutated rather than replaced: a plugin that took a reference to the shared
 * state at boot must still be looking at the same object.
 */
function assignWorldState(world, capture, missing) {
  for (const key of Object.keys(world.state)) delete world.state[key]
  Object.assign(world.state, readField(capture.state || {}, world, missing, 'world.state'))
  world.simulated = !!capture.simulated
}

/**
 * Tell the plugins play started, and start the loop, when the moment was playing.
 *
 * The entities are not started again: they already ran their start hooks in the
 * page that went away, and running them twice would reset the very state this
 * restore exists to keep.
 */
function startCapturedPlay(capture, loop, bus) {
  if (!capture.playing || loop.running) return
  bus.emit('play:started')
  loop.start()
}

/**
 * Put the clock and the random stream back where the capture left them.
 *
 * Last, because spawning an entity and starting play both reach plugins, and a
 * plugin that took a random number while the world was being rebuilt would leave
 * the stream a draw or two past where the run had it.
 */
function resumeCapturedClock(capture, loop) {
  loop.resume({ steps: capture.steps ?? 0, seed: capture.seed, draws: capture.draws ?? 0 })
}

/** Announce the restored world, which a plugin that lists what it spawned rebuilds from. */
function announceRestored(capture, editor, world, bus, context) {
  editor.select(capture.selection || [])
  bus.emit('world:changed')
  // Said apart from `world:changed` because it means something that event does
  // not: these entities are back from a run that already happened, not placed
  // by a level. A plugin holding a list of what it spawned rebuilds it here, and
  // that is the only way such a list can come back — the kernel cannot know
  // which of its groups a restored entity belonged to.
  bus.emit('world:restored', { level: editor.levelName, entities: world.entities.length, capture })
  context?.redraw?.()
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
  spawnCapturedEntities(capture, world, missing, notRestored)
  assignWorldState(world, capture, missing)
  startCapturedPlay(capture, loop, bus)
  resumeCapturedClock(capture, loop)

  // Last, because both play and the focus plugins move the camera when play
  // starts, and where the camera actually was is part of the moment.
  Object.assign(view, capture.view)
  announceRestored(capture, editor, world, bus, context)

  const { losses, hold } = restoreLosses(capture, { world, loop, missing, fromLevel })
  notRestored.push(...losses)
  // Held by name, not merely reported: those entities are back and standing in
  // the right places, so the world LOOKS exactly like the one that was lost —
  // and it will not run like it, because whatever list drove them was rebuilt
  // empty. Nothing moves until somebody says it may.
  if (hold) loop.hold(LOOK_ONLY)

  return {
    level: editor.levelName,
    entities: world.entities.length,
    simulated: world.simulated,
    playing: loop.running,
    lookOnly: loop.holds.includes(LOOK_ONLY),
    notRestored
  }
}

/** A rotation, included only when the entity had a nonzero one. */
function rotationPlacement(held) {
  return held.rotation ? { rotation: held.rotation } : {}
}

/** A scale, included only when the entity had a non-default one. */
function scalePlacement(held) {
  return held.scale !== 1 ? { scale: held.scale } : {}
}

/** A sprite, included only when the placement itself set it. */
function spritePlacement(held) {
  return held.setByPlacement?.sprite && held.sprite ? { sprite: held.sprite } : {}
}

/** A marker for a mesh the placement itself set; the live values write the mesh. */
function meshPlacement(held) {
  return held.setByPlacement?.mesh && held.mesh ? { mesh: {} } : {}
}

/** A collider, included only when the placement itself set it. */
function colliderPlacement(held) {
  return held.setByPlacement?.collider && held.collider ? { collider: held.collider } : {}
}

/** A behaviour bag, included only when the placement named one. */
function behaviourPlacement(attached) {
  return attached ? { behaviours: attached } : {}
}

/**
 * The overrides whose value survived.
 *
 * An override naming a key with nothing behind it would write `undefined` into
 * the level on the next save, which reads as a decision somebody made.
 */
function overrideProperties(held) {
  return Object.fromEntries(held.overrides
    .filter(key => held.properties[key] !== undefined)
    .map(key => [key, held.properties[key]]))
}

/**
 * The placement a restored entity is spawned from.
 *
 * The placement flags decide what a later type reload is allowed to overwrite,
 * so they are restored as flags and the live values are written over the top
 * afterwards.
 */
function placementOf(held) {
  const attached = placementBehaviours(held)
  return {
    id: held.id,
    at: held.at,
    ...rotationPlacement(held),
    ...scalePlacement(held),
    ...spritePlacement(held),
    ...meshPlacement(held),
    ...colliderPlacement(held),
    properties: overrideProperties(held),
    ...behaviourPlacement(attached),
    ...held.extra
  }
}

/**
 * Put one projected field back, naming any entity reference the world no longer
 * holds. The name says where the reference was, so a missing one is found
 * rather than guessed at.
 */
function readField(value, world, missing, where) {
  return resolve(value, id => world.byId(id), (at, id) => {
    missing.push(`${at} pointed at "${id}", which is not in the restored world`)
  }, where)
}

/**
 * The live values of one restored entity, written over what the level placed.
 *
 * The id is restored rather than inferred from the placement: an entity spawned
 * mid-run carried no id of its own, and giving it back through a placement would
 * add one — which the next save would then write into the level file as though
 * the author had put it there. Properties are assigned over the type's defaults
 * rather than replacing them, so a value that could not be captured keeps the
 * file's answer instead of vanishing.
 */
function applyLiveValues(entity, held, world, missing) {
  entity.x = held.at[0]
  entity.y = held.at[1]
  entity.z = held.at[2]
  entity.rotation = held.rotation
  entity.scale = held.scale
  entity.hidden = held.hidden
  entity._extraKeys = { ...held.extra }
  if (held.sprite) entity.sprite = held.sprite
  if (held.mesh) entity.mesh = held.mesh
  if (held.collider) entity.collider = held.collider
  Object.assign(entity.properties, readField(held.properties, world, missing, `${held.id}.properties`))
  for (const [key, value] of Object.entries(held.fields)) {
    entity[key] = readField(value, world, missing, `${held.id}.${key}`)
  }
}

/**
 * What the restore could not carry, and whether the world may run on.
 *
 * Read once the world is built, because every claim is about what came back: a
 * type whose file is gone, a clock or stream that did not land where the capture
 * left it, and the entities a plugin made, whose driving list came back empty.
 * Apart from the restore so the report is a value the caller acts on, and the
 * hold stays with the caller that owns the loop.
 */
/** The loss for types whose files the project no longer has, or null. */
function lostTypeLoss(capture, world) {
  const lostTypes = (capture.types || []).filter(name => !world.types.has(name))
  if (!lostTypes.length) return null
  const plural = lostTypes.length === 1 ? '' : 's'
  return `the type${plural} ${lostTypes.join(', ')}, whose file the project no longer has — entities of that name came back with no definition behind them`
}

/** The loss for a clock that did not land where the capture left it, or null. */
function clockLoss(capture, loop) {
  if (loop.steps === (capture.steps ?? 0)) return null
  return `the clock, which was ${capture.time}s and is now ${round3(loop.time)}s`
}

/** The loss for a random stream that did not land where the capture left it, or null. */
function streamLoss(capture, loop) {
  if (loop.random.seed === capture.seed && loop.random.draws === (capture.draws ?? 0)) return null
  return `the random stream, which was ${capture.draws ?? 0} draws into seed ${capture.seed} and is now ${loop.random.draws} into seed ${loop.random.seed}`
}

/** The loss for scheduled callbacks, which are closures and cannot be written down. */
function timerLoss(capture) {
  if (!capture.timers) return null
  return `${capture.timers} scheduled ${capture.timers === 1 ? 'callback' : 'callbacks'}, which are closures and cannot be written down`
}

/** The loss for fields that held something other than data, or null. */
function droppedLoss(capture) {
  const dropped = capture.dropped
  if (!dropped?.length) return null
  return `${dropped.length} field${dropped.length === 1 ? '' : 's'} that held something other than data: ${dropped.slice(0, 8).join(', ')}`
}

/**
 * Why the world may not run on: entities a plugin made came back with an empty
 * driving list.
 *
 * The vague half of this used to be the whole of it, and a vague loss is one
 * nobody acts on. These entities are countable, so count them and say what the
 * consequence is.
 */
function pluginListLoss(madeInTheRun, total) {
  return `the lists plugins keep of what they spawned. ${madeInTheRun} of the ${total} entities were made during the run rather than by the level, and the crowd, pool or wave counter that drove them came back empty — so this world will not simulate the same as the one that was lost. `
    + `It is held still under the name "${LOOK_ONLY}" for that reason: look at it, and do not run it on. `
    + `engine.stop() gives you the level as authored; engine.loop.release("${LOOK_ONLY}") runs it anyway, knowing that`
}

/**
 * What the restore could not carry, and whether the world may run on.
 *
 * Read once the world is built, because every claim is about what came back: a
 * type whose file is gone, a clock or stream that did not land where the capture
 * left it, and the entities a plugin made, whose driving list came back empty.
 * Apart from the restore so the report is a value the caller acts on, and the
 * hold stays with the caller that owns the loop.
 */
function restoreLosses(capture, { world, loop, missing, fromLevel }) {
  const losses = [...missing]
  // Claimed only when true. The clock and the stream are restored now, and a
  // notice that went on saying they were not would be the same silence in a
  // different voice.
  for (const loss of [
    lostTypeLoss(capture, world),
    clockLoss(capture, loop),
    streamLoss(capture, loop),
    timerLoss(capture),
    droppedLoss(capture)
  ]) {
    if (loss) losses.push(loss)
  }

  const madeInTheRun = capture.entities.filter(held => !fromLevel.has(held.id)).length
  if (madeInTheRun) losses.push(pluginListLoss(madeInTheRun, capture.entities.length))
  else losses.push('anything a plugin holds outside the world, which was rebuilt from boot')
  return { losses, hold: madeInTheRun > 0 }
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
