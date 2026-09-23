/**
 * Kernel: the checkpoint projection and the level shape.
 *
 * A world is written down in two directions. `captureCheckpoint` and `restoreCheckpoint`
 * turn live entities into plain data and back, so the world can be rewound to a
 * moment; `levelFromWorld` writes the level shape, so a save keeps every decision
 * the level file can hold.
 *
 * The walk over a single value lives in `value-projection.js`, under the policy
 * below. This file adds what a checkpoint is: which entity fields to carry, and
 * how to put an entity back without handing out a new object.
 *
 * Both read `world.entities`, `world.state`, `world.types` and `world.behaviours`
 * and do not own them. `world.js` owns the store and puts the entities back.
 */
import { makeValueProjection } from './value-projection.js'
import { placementBehaviours, overriddenProperties } from './placement-projection.js'
import { round3 } from './round3.js'
import { expand, sameLook, lookDiff } from './world-look.js'

/**
 * How deep a checkpoint copies before it stops.
 *
 * A behaviour may keep a structure of its own, and a checkpoint that walked one
 * for ever would be worse than one that says how far it went.
 */
const CHECKPOINT_DEPTH = 6

/** Bumped when the shape of a checkpoint changes, so an old one is refused rather than misread. */
const CHECKPOINT_VERSION = 1

/**
 * What a checkpoint keeps and loses.
 *
 * The moment is held in memory, so Set and Map and the primitives JSON cannot
 * write all survive. Only a function, a value past the depth, and an object that
 * is not plain data are left behind, and one array element at a time.
 */
const { project, resolve } = makeValueProjection({
  maxDepth: CHECKPOINT_DEPTH,
  keepContainers: true,
  keepLostKeys: true,
  loseWholeArray: false,
  keepUndefined: true,
  keepNonFinite: true,
  keepOtherPrimitives: true,
  entityTag: '$entity',
  report(lost, loss) {
    if (loss.reason === 'function') lost.push(`${loss.where} is a function`)
    else if (loss.reason === 'deep') lost.push(`${loss.where} is deeper than ${loss.maxDepth}`)
    else if (loss.reason === 'notPlain')
      lost.push(`${loss.where} is a ${loss.name || 'object'}, which a checkpoint cannot copy`)
  }
})

/**
 * Everything about this world that a checkpoint has to carry.
 *
 * Plain values, copied, so the checkpoint is a moment rather than a view of a
 * world that carries on changing. What could not be copied is named in `lost`,
 * so a checkpoint that is not exact says so instead of pretending.
 *
 * Not here: the clock, the random stream and the input record, which belong to
 * the loop, and anything a plugin keeps of its own — a solver's world, for one.
 * Those travel beside this, not inside it.
 *
 * @param {object} world The world to read.
 * @returns {object} The checkpoint: version, the simulated flag, the shared
 *   state, and one entry per entity.
 */
export function captureCheckpoint(world) {
  const lost = []
  const entities = world.entities
  const live = new Set(entities)
  const taken = entities.map(entity => {
    const names = new Set(entity.behaviours.map(record => record.name))
    const fields = {}
    for (const key of Object.keys(entity)) {
      // `_definition` is the type itself, hooks and all, and is looked up
      // again on the way back. A behaviour's bag is carried with its record
      // rather than twice, once as `e[name]` and once as the bag.
      if (key === '_definition' || key === 'behaviours' || names.has(key)) continue
      fields[key] = project(entity[key], live, lost, `${entity.id}.${key}`)
    }
    return {
      fields,
      behaviours: entity.behaviours.map(record => ({
        name: record.name,
        own: !!record.own,
        overrides: [...record.overrides],
        error: record.error,
        bag: project(record.bag, live, lost, `${entity.id}.${record.name}`)
      }))
    }
  })
  return {
    version: CHECKPOINT_VERSION,
    simulated: world.simulated,
    state: project(world.state, live, lost, 'world.state'),
    entities: taken,
    lost
  }
}

/**
 * Put this world back to a checkpoint.
 *
 * An entity is matched by id and written INTO the object already here rather
 * than replaced. Identity is what everything else holds: the solver maps an
 * entity to a body, a behaviour watches one, a chase remembers one. A restore
 * that handed out new objects would break every one of them, and the symptom
 * would look like a physics bug.
 *
 * The entity list is returned rather than assigned, because `world.js` owns the
 * store. Every entity is found or made FIRST, with its keys cleared, so that a
 * value pointing at one — a field holding an entity, or the shared state holding
 * one — has something to point at. Resolving references as the fields were
 * assigned would depend on the order the entities happened to be captured in,
 * and would lose any entity the world had destroyed since.
 *
 * @param {object} world The world to write into.
 * @param {object} capture From `captureCheckpoint`.
 * @param {Function} makeEntity Builds an entity the checkpoint created.
 * @returns {object} The entities for the store, and how much was lost.
 */
export function restoreCheckpoint(world, capture, makeEntity) {
  if (capture?.version !== CHECKPOINT_VERSION)
    throw new Error(`checkpoint version ${capture?.version} is not ${CHECKPOINT_VERSION}`)
  const byId = new Map(world.entities.map(entity => [entity.id, entity]))
  const resolveEntity = id => byId.get(id)

  const rebuilt = capture.entities.map(entry => {
    const fields = entry.fields
    const entity = byId.get(fields.id) || makeEntity(fields.type, { id: fields.id })
    byId.set(fields.id, entity)
    for (const key of Object.keys(entity)) if (key !== '_definition') delete entity[key]
    return { entity, entry }
  })

  for (const { entity, entry } of rebuilt) {
    for (const key of Object.keys(entry.fields)) entity[key] = resolve(entry.fields[key], resolveEntity)
    entity._definition = world.types.get(entity.type) || {}
    entity.behaviours = entry.behaviours.map(record => ({
      name: record.name,
      own: record.own,
      overrides: [...record.overrides],
      error: record.error,
      definition: world.behaviours.get(record.name) || {},
      bag: resolve(record.bag, resolveEntity)
    }))
    for (const record of entity.behaviours) entity[record.name] = record.bag
  }

  // The state object keeps its identity: a plugin that read it once still has
  // the same object, holding the values from before.
  for (const key of Object.keys(world.state)) delete world.state[key]
  Object.assign(world.state, resolve(capture.state, resolveEntity))
  world.simulated = !!capture.simulated
  return { entities: rebuilt.map(one => one.entity), lost: capture.lost.length }
}

/** The simple placement fields an entity carries: where it is and how it is placed. */
function placementFields(entity) {
  const out = { type: entity.type, at: [round(entity.x), round(entity.y), round(entity.z)] }
  if (entity.rotation) out.rotation = round(entity.rotation)
  if (entity.scale !== 1) out.scale = round(entity.scale)
  if (entity.note) out.note = entity.note
  return out
}

/** The look overrides this placement carries, which a save must write back out. */
function lookOverrides(entity) {
  const out = {}
  if (entity.collider && entity.collider !== entity._definition.collider) out.collider = entity.collider
  // Same rule for the sprite: if this placement carries its own, it has
  // to come back out, or changing one crate's art is lost on save.
  if (entity.sprite && !sameLook(entity.sprite, entity._definition.sprite, 'image')) out.sprite = entity.sprite
  // Only the keys this placement disagrees with its type about. Writing
  // the whole mesh back turned one decision into a copy of the material.
  const ownMesh = lookDiff(entity.mesh, expand(entity._definition.mesh, 'texture'))
  if (ownMesh) out.mesh = ownMesh
  return out
}

/** One entity as the level-shaped placement a save must not narrow. */
function placementFromEntity(entity) {
  const attached = placementBehaviours(entity.behaviours, entity._detached)
  return {
    ...entity._extraKeys,
    ...placementFields(entity),
    ...lookOverrides(entity),
    ...(attached ? { behaviours: attached } : {}),
    ...(entity.overrides.length
      ? { properties: overriddenProperties(entity.overrides, entity.properties, { keepUndefined: true }) }
      : {})
  }
}

/**
 * Serialise a world back to the level shape.
 *
 * A save must never narrow the file: anything the placement carried that the
 * entity does not model (a per-instance collider, a sprite override) is
 * written straight back out. Overrides stay plain JSON so a diff is readable.
 *
 * @param {object} world The world to read.
 * @param {object} camera The camera block the level file carries.
 * @returns {object} The level: `camera`, and one placement per entity.
 */
export function levelFromWorld(world, camera) {
  return {
    camera,
    entities: world.entities.map(placementFromEntity)
  }
}

/**
 * Three decimal places, over a number or a list of them.
 *
 * `rotation` is written both ways: a bare number is yaw in degrees, `[x, y, z]`
 * is pitch, yaw and roll in degrees. A list must stay a list — `Math.round` of
 * one is NaN, and JSON writes NaN as null, so a save would drop it.
 */
const round = value => (Array.isArray(value) ? value.map(round) : round3(value))
