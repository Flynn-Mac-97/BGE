/**
 * Kernel: the checkpoint projection and the level shape.
 *
 * A world is written down in two directions. `captureWorld` and `restoreWorld`
 * turn live entities into plain data and back, so the world can be rewound to a
 * moment; `levelFromWorld` writes the level shape, so a save keeps every decision
 * the level file can hold.
 *
 * Both read `world.entities`, `world.state`, `world.types` and `world.behaviours`
 * and do not own them. `world.js` owns the store and puts the entities back.
 */
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

/** A value a checkpoint could not carry, kept apart from `null`, which is a value. */
const LOST = Symbol('lost')

/**
 * What a value becomes on the way into a checkpoint.
 *
 * Plain data is COPIED, because a checkpoint that shares a live object changes
 * when the world carries on and is then no longer a checkpoint. A reference to
 * another entity is written down as its id and resolved again on the way back:
 * a state object holding two entities is a graph, and copying it would quietly
 * split it into two. Anything else — a function, a node from outside — is
 * counted and named, because a checkpoint that dropped something in silence is
 * worse than one that says what it could not keep.
 */
function asCopy(value, live, lost, where, depth = 0) {
  if (value === null) return null
  if (typeof value === 'function') { lost.push(`${where} is a function`); return LOST }
  if (typeof value !== 'object') return value
  if (live.has(value)) return { $entity: value.id }
  if (depth >= CHECKPOINT_DEPTH) { lost.push(`${where} is deeper than ${CHECKPOINT_DEPTH}`); return LOST }
  if (Array.isArray(value)) return value.map((item, at) => asCopy(item, live, lost, `${where}[${at}]`, depth + 1))
  if (value instanceof Set) return { $set: [...value].map((item, at) => asCopy(item, live, lost, `${where}<${at}>`, depth + 1)) }
  if (value instanceof Map) return {
    $map: [...value].map(([key, item]) => [
      asCopy(key, live, lost, `${where} key`, depth + 1),
      asCopy(item, live, lost, `${where}[${String(key)}]`, depth + 1)])
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    lost.push(`${where} is a ${value.constructor?.name || 'object'}, which a checkpoint cannot copy`)
    return LOST
  }
  const copy = {}
  for (const key of Object.keys(value)) copy[key] = asCopy(value[key], live, lost, `${where}.${key}`, depth + 1)
  return copy
}

/** The other direction. A reference to an entity resolves against the world it goes back into. */
function asValue(copy, byId) {
  if (copy === LOST) return undefined
  if (copy === null || typeof copy !== 'object') return copy
  if (Array.isArray(copy)) return copy.map(item => asValue(item, byId))
  if (typeof copy.$entity === 'string') return byId.get(copy.$entity) || null
  if (Array.isArray(copy.$set)) return new Set(copy.$set.map(item => asValue(item, byId)))
  if (Array.isArray(copy.$map)) return new Map(copy.$map.map(([key, item]) => [asValue(key, byId), asValue(item, byId)]))
  const value = {}
  for (const key of Object.keys(copy)) value[key] = asValue(copy[key], byId)
  return value
}

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
export function captureWorld(world) {
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
      fields[key] = asCopy(entity[key], live, lost, `${entity.id}.${key}`)
    }
    return {
      fields,
      behaviours: entity.behaviours.map(record => ({
        name: record.name,
        own: !!record.own,
        overrides: [...record.overrides],
        error: record.error,
        bag: asCopy(record.bag, live, lost, `${entity.id}.${record.name}`)
      }))
    }
  })
  return {
    version: CHECKPOINT_VERSION,
    simulated: world.simulated,
    state: asCopy(world.state, live, lost, 'world.state'),
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
 * @param {object} capture From `captureWorld`.
 * @param {Function} makeEntity Builds an entity the checkpoint created.
 * @returns {object} The entities for the store, and how much was lost.
 */
export function restoreWorld(world, capture, makeEntity) {
  if (capture?.version !== CHECKPOINT_VERSION) throw new Error(`checkpoint version ${capture?.version} is not ${CHECKPOINT_VERSION}`)
  const byId = new Map(world.entities.map(entity => [entity.id, entity]))

  const rebuilt = capture.entities.map(entry => {
    const fields = entry.fields
    const entity = byId.get(fields.id) || makeEntity(fields.type, { id: fields.id })
    byId.set(fields.id, entity)
    for (const key of Object.keys(entity)) if (key !== '_definition') delete entity[key]
    return { entity, entry }
  })

  for (const { entity, entry } of rebuilt) {
    for (const key of Object.keys(entry.fields)) entity[key] = asValue(entry.fields[key], byId)
    entity._definition = world.types.get(entity.type) || {}
    entity.behaviours = entry.behaviours.map(record => ({
      name: record.name,
      own: record.own,
      overrides: [...record.overrides],
      error: record.error,
      definition: world.behaviours.get(record.name) || {},
      bag: asValue(record.bag, byId)
    }))
    for (const record of entity.behaviours) entity[record.name] = record.bag
  }

  // The state object keeps its identity: a plugin that read it once still has
  // the same object, holding the values from before.
  for (const key of Object.keys(world.state)) delete world.state[key]
  Object.assign(world.state, asValue(capture.state, byId))
  world.simulated = !!capture.simulated
  return { entities: rebuilt.map(one => one.entity), lost: capture.lost.length }
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
    entities: world.entities.map(e => {
      const out = { type: e.type, at: [round(e.x), round(e.y), round(e.z)] }
      if (e.rotation) out.rotation = round(e.rotation)
      if (e.scale !== 1) out.scale = round(e.scale)
      if (e.note) out.note = e.note
      if (e.collider && e.collider !== e._definition.collider) out.collider = e.collider
      // Same rule for the sprite: if this placement carries its own, it has
      // to come back out, or changing one crate's art is lost on save.
      if (e.sprite && !sameLook(e.sprite, e._definition.sprite, 'image')) out.sprite = e.sprite
      // Only the keys this placement disagrees with its type about. Writing
      // the whole mesh back turned one decision into a copy of the material.
      const ownMesh = lookDiff(e.mesh, expand(e._definition.mesh, 'texture'))
      if (ownMesh) out.mesh = ownMesh
      const attached = behaviourPlacement(e)
      if (attached) out.behaviours = attached
      if (e.overrides.length) {
        out.properties = {}
        for (const k of e.overrides) out.properties[k] = e.properties[k]
      }
      return { ...e._extraKeys, ...out }
    })
  }
}

/**
 * What this PLACEMENT has to say about behaviours — never what its type says.
 *
 * Only what it added, changed, or took off, so a level diff shows the decision
 * somebody made rather than the whole inherited list. Array form when there is
 * nothing to configure, because `["float"]` is what a person would have typed.
 */
function behaviourPlacement(e) {
  const out = {}
  for (const b of e.behaviours) {
    if (!b.own && !b.overrides.length) continue
    out[b.name] = Object.fromEntries(b.overrides.map(k => [k, b.bag[k]]))
  }
  for (const name of e._detached) out[name] = false

  const names = Object.keys(out)
  if (!names.length) return null
  return names.every(n => out[n] && !Object.keys(out[n]).length) ? names : out
}

/**
 * Three decimal places, over a number or a list of them.
 *
 * `rotation` is written both ways: a bare number is yaw in degrees, `[x, y, z]`
 * is pitch, yaw and roll in degrees. A list must stay a list — `Math.round` of
 * one is NaN, and JSON writes NaN as null, so a save would drop it.
 */
const round = value =>
  Array.isArray(value) ? value.map(round) : round3(value)
