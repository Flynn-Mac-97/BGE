/**
 * Kernel: the entity store and the shared vocabulary every plugin reads and writes.
 *
 * An entity is flat. Position lives on the entity, not on a Transform that lives
 * on the entity: e.x, not e.transform.position.x.
 *
 * The one form of composition is a *behaviour*: a file shaped exactly like a
 * type, minus the art, that a type or a single placement can attach by name.
 * It is deliberately not a component system — a behaviour cannot be queried,
 * cannot find another behaviour, and has no lifecycle beyond the same four
 * hooks everything else has. All it can do is read and write the entity.
 */

let nextId = 1

/** Placement keys the entity models directly; everything else is preserved verbatim. */
const HANDLED = new Set(['type', 'at', 'rotation', 'scale', 'properties', 'sprite', 'mesh', 'collider', 'behaviours', 'note'])

/**
 * Names a behaviour may not take.
 *
 * Each behaviour gets `e[name]` as its own bag, so a behaviour called `scale`
 * would quietly replace the entity's scale with an object and the symptom would
 * be a thing that stops drawing. Refused by name instead, at attach time.
 */
const RESERVED = new Set([
  'id', 'type', 'x', 'y', 'z', 'rotation', 'scale', 'sprite', 'mesh', 'collider',
  'properties', 'overrides', 'behaviours', 'hidden', 'play', 'note',
  'velocityX', 'velocityY', 'velocityZ', 'grounded', 'animation', 'frame', 'flip', 'animationDone'
])

/**
 * Both ways of writing an attachment list, reduced to one shape.
 *
 *   behaviours: ['float']                  nothing to configure
 *   behaviours: { float: { speed: 3 } }    defaults changed here
 *   behaviours: { float: false }           this placement takes it back off
 */
const asAttached = v => {
  if (!v) return {}
  if (Array.isArray(v)) return Object.fromEntries(v.map(n => [n, {}]))
  return v
}

/** Expand the shorthand form of a value: 'coin.png' -> { image: 'coin.png' } */
const expand = (v, key) => (typeof v === 'string' ? { [key]: v } : v)

/**
 * The entity always holds the expanded object form, but the type may have
 * declared the string shorthand — compare what they mean, not how they were
 * written, or every save writes an override that is not one.
 */
const sameLook = (a, b, key) => {
  const norm = v => JSON.stringify(expand(v, key) ?? null)
  return norm(a) === norm(b)
}

/**
 * A placement's `mesh` MERGES over the type's, key by key — it does not replace it.
 *
 * Replacing was the obvious reading and it was wrong. A map is hundreds of walls
 * that share one texture and differ only in size, and under replacement every one
 * of them had to repeat the texture, the tiling and the tint in order to change
 * the box. de_dust2 came out at 3,300 lines where 1,300 would do, and every read
 * of that file paid the difference. `properties` has always merged; this is the
 * same rule applied to the other thing a placement customises.
 *
 * `tint` is the key this surprises people on. A tint MULTIPLIES the texture
 * rather than standing in for one, so a tint on the TYPE is not a fallback: it
 * colours every textured placement that did not state its own, and the level
 * file says nothing about it. `check` reports that pair — see `tintProblems` in
 * engine/project-index.mjs.
 */
const mergeLook = (base, over, key) => {
  const a = expand(base, key)
  const b = expand(over, key)
  if (!a) return b
  if (!b) return a
  return { ...a, ...b }
}

/** What this value says that its type default does not. The decision, not the copy. */
const lookDiff = (value, base) => {
  if (!value) return null
  const out = {}
  for (const [k, v] of Object.entries(value)) {
    if (JSON.stringify(base?.[k]) !== JSON.stringify(v)) out[k] = v
  }
  return Object.keys(out).length ? out : null
}

/**
 * The numbers a run is compared by.
 *
 * A fingerprint has to be exact to be worth anything: one that rounded would
 * call two different worlds the same, and every comparison built on it would be
 * a comfort rather than a check. So each value goes in as its own bits.
 */
const scratch = new Float64Array(1)
const scratchBits = new Uint32Array(scratch.buffer)

/** Fold one 32-bit word into the running hash. */
const fold = (hash, word) => {
  let mixed = Math.imul((hash ^ word) >>> 0, 0x21f0aaad) >>> 0
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x735a2d97) >>> 0
  return (mixed ^ (mixed >>> 15)) >>> 0
}

/**
 * Fold a number in by its bits.
 *
 * `-0` is normalised to `0`: the two are the same number, and a negative zero
 * arriving from one arithmetic path and not another would report a difference
 * that is not one.
 */
const foldNumber = (hash, value) => {
  scratch[0] = value === 0 ? 0 : Number(value)
  return fold(fold(hash, scratchBits[0]), scratchBits[1])
}

/** Fold text in, one code unit at a time. */
const foldText = (hash, text) => {
  let out = hash
  for (let at = 0; at < text.length; at++) out = fold(out, text.charCodeAt(at))
  return out
}

/** Distinct words, so "absent", "null" and "unreadable" do not read alike. */
const ABSENT = 0x297a2d39
const NOTHING = 0x2c1b3c6d
const OTHER = 0x1b873593
const RECORD = 0x85ebca6b
const LIST = 0x9e3779b9

/**
 * How deep to walk before a value is folded as a single word.
 *
 * An entity may point at something that points back at it, and a hash is not
 * worth a stack overflow.
 */
const DEPTH = 5

/**
 * Fold one value in, whatever shape it is.
 *
 * Lists have to be walked rather than converted. `Number([16, 1, 1])` is `NaN`,
 * so a scale or a rotation written as a vector folded to one constant and the
 * hash was blind to it — two worlds differing only in a rotated body hashed the
 * same, which is the worst way for a check to fail.
 *
 * Records are folded by sorted key, so the order a plugin happened to set them
 * does not change the answer.
 */
const foldValue = (hash, value, depth = 0) => {
  if (typeof value === 'number') return foldNumber(hash, value)
  if (typeof value === 'boolean') return fold(hash, value ? 1 : 2)
  if (typeof value === 'string') return foldText(hash, value)
  if (value === null) return fold(hash, NOTHING)
  if (value === undefined) return fold(hash, ABSENT)
  if (depth >= DEPTH) return fold(hash, OTHER)
  if (Array.isArray(value)) {
    let out = fold(hash, LIST ^ value.length)
    for (const item of value) out = foldValue(out, item, depth + 1)
    return out
  }
  if (typeof value === 'object') {
    let out = fold(hash, RECORD)
    for (const key of Object.keys(value).sort()) out = foldValue(foldText(out, key), value[key], depth + 1)
    return out
  }
  return fold(hash, OTHER)
}

/**
 * The one field of an entity that is not state.
 *
 * `_definition` is the type the entity was built from: a live object holding the
 * hooks themselves. Folding it would walk functions rather than numbers, and
 * would arrive back at the entity that points at it.
 */
const NOT_STATE = new Set(['_definition'])

/**
 * A number that changes whenever the simulated world does.
 *
 * Two runs of the same level, seed and steps answer with the same number, and a
 * run that diverged answers with a different one — so "did my change alter the
 * simulation" is one value to compare rather than a thousand rows to read, and a
 * rewind or a restored world is proved exact rather than eyeballed.
 *
 * Everything an entity carries is folded, except its type definition, so a field
 * a plugin adds later is in the hash without anyone remembering to add it here.
 * A behaviour's own bag is folded too: it is where a behaviour keeps its running
 * state, and a behaviour that diverged there would change the next step without
 * changing anything the entity shows today.
 *
 * Takes the world as an argument rather than being a method on one, so a test
 * double standing in for a world needs only `entities` and `state` to answer it.
 *
 * @param {object} world The world to read.
 * @returns {number} A 32-bit number.
 */
export function stateHash(world) {
  const entities = world.entities
  let hash = fold(0x811c9dc5, entities.length)
  for (const e of entities) {
    hash = foldValue(hash, e.id)
    hash = foldValue(hash, e.type)
    for (const key of Object.keys(e)) {
      if (NOT_STATE.has(key) || key === 'behaviours') continue
      hash = foldValue(foldText(hash, key), e[key])
    }
    for (const record of e.behaviours || []) {
      hash = foldValue(foldText(hash, record.name), record.bag)
    }
  }
  // A world in a test may stand in with nothing but its entities.
  return foldValue(hash, world.state || {})
}

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
 * The entity store, the type and behaviour registries, and the hooks that run
 * them.
 *
 * State lives in the closure, so two worlds share nothing and a test makes one
 * per case. The bus is the only way out: every change worth noticing is
 * emitted, and a reader listens rather than polling.
 *
 * @param {object} bus The bus every change is announced on.
 * @returns {object} The world: `entities`, the `types` and `behaviours`
 *   registries, the hooks, and the methods that spawn, retype and serialise.
 */
export function makeWorld(bus) {
  let entities = []
  const types = new Map()
  const behaviours = new Map()

  /**
   * Build one entity from a placement, filling in the type's defaults.
   *
   * The type is read once here and kept as `_definition`, so a later edit can
   * find every entity still running the old one — see `retype`.
   */
  function makeEntity(typeName, placement = {}) {
    const type = types.get(typeName) || {}
    const at = placement.at || [0, 0, 0]

    const e = {
      id: placement.id || `${typeName}-${nextId++}`,
      type: typeName,

      x: at[0] ?? 0,
      y: at[1] ?? 0,
      z: at[2] ?? 0,
      rotation: placement.rotation ?? 0,
      scale: placement.scale ?? 1,

      sprite: expand(placement.sprite ?? type.sprite, 'image'),
      // The 3D counterpart of `sprite`: solid geometry rather than a textured
      // plane. A thing declares one or the other, never both — `mesh` is what
      // the renderer draws when it is there. It merges rather than replaces, so
      // a placement can change the box without restating the material.
      mesh: mergeLook(type.mesh, placement.mesh, 'texture'),
      collider: placement.collider ?? type.collider ?? null,

      // properties: type defaults, overridden per placement. Overrides stay visible.
      properties: { ...(type.properties || {}), ...(placement.properties || {}) },
      overrides: Object.keys(placement.properties || {}),

      hidden: false,

      // Why THIS one is placed here. It adds to what the type says a thing is;
      // it never restates it, because the type is described once and read from
      // one place. Modelled rather than preserved verbatim so `set` can write
      // it and the inspector can edit it.
      note: placement.note ?? null,

      _definition: type,

      // What this entity composes, in the order the hooks run. Each record
      // carries its own bag; the bag is also exposed as e[name].
      behaviours: [],
      // Behaviours the TYPE declares that this placement took off. Recorded, or
      // the next load puts them straight back.
      _detached: new Set(),

      // Which of these this placement set for itself. Needed when a type is
      // reloaded: a placement's own collider must survive, a inherited one
      // must follow the file.
      _setByPlacement: {
        sprite: placement.sprite !== undefined,
        mesh: placement.mesh !== undefined,
        collider: placement.collider !== undefined
      },

      // Anything the placement carried that the entity does not model directly.
      // Kept so a save round-trips the file rather than silently narrowing it.
      _extraKeys: Object.fromEntries(
        Object.entries(placement).filter(([k]) => !HANDLED.has(k))
      )
    }

    const fromType = asAttached(type.behaviours)
    const fromPlacement = asAttached(placement.behaviours)
    for (const name of [...Object.keys(fromType), ...Object.keys(fromPlacement)]) {
      if (e.behaviours.some(b => b.name === name)) continue
      if (fromPlacement[name] === false) { e._detached.add(name); continue }
      addBehaviour(e, name, {
        own: !(name in fromType),
        typeProps: fromType[name] || {},
        overrides: fromPlacement[name] || {}
      })
    }
    return e
  }

  /**
   * Give a behaviour its bag and put it in the run order.
   *
   * The bag is the whole namespace: declared properties start in it, and the
   * behaviour keeps its running state there too. So two behaviours can never
   * collide over a name, and neither can collide with the type's properties.
   *
   * A behaviour whose file is missing or broken is still recorded, with the
   * reason. Dropping it would lose it from the level file on the next save —
   * silently deleting the author's work because a file had a typo in it.
   */
  function addBehaviour(e, name, { own = true, typeProps = {}, overrides = {} } = {}) {
    const record = { name, own, overrides: Object.keys(overrides), definition: {}, error: null }

    if (RESERVED.has(name)) record.error = `"${name}" is already an entity field`
    else if (!behaviours.has(name)) record.error = `no behaviours/${name}.js`
    else record.definition = behaviours.get(name)

    record.bag = { ...(record.definition.properties || {}), ...typeProps, ...overrides }
    if (!RESERVED.has(name)) e[name] = record.bag

    if (record.error) console.error(`[behaviour] ${e.id} — ${record.error}`)
    e.behaviours.push(record)
    return record
  }

  /**
   * Bring one entity's type-declared behaviours back in line with its type file.
   *
   * Called on retype, so adding `behaviours: ['float']` to a type file takes
   * effect on everything already placed. Anything this placement added or took
   * off for itself is left alone.
   */
  function syncTypeBehaviours(e, definition) {
    const fromType = asAttached(definition.behaviours)
    const order = Object.keys(fromType)

    for (const b of [...e.behaviours]) {
      if (b.own || b.name in fromType) continue
      e.behaviours.splice(e.behaviours.indexOf(b), 1)
      delete e[b.name]
    }
    for (const name of order) {
      if (e._detached.has(name) || e.behaviours.some(b => b.name === name)) continue
      addBehaviour(e, name, { own: false, typeProps: fromType[name] || {} })
    }

    // Order is the declared order, so a file edit that reorders the list
    // reorders the hooks. Placement-added ones run after the type's.
    const rank = b => (b.own ? order.length + 1 : order.indexOf(b.name))
    e.behaviours.sort((a, b) => rank(a) - rank(b))
  }

  /**
   * Run one hook: every behaviour in order, then the type's own.
   *
   * The type goes last so it can correct whatever it composed. A behaviour
   * receives one extra argument — its own bag — so it never has to hardcode
   * the name of the file it happens to live in.
   *
   * Errors are named `type:behaviour`, because "which of the four things
   * attached to this crate threw" is the only question worth asking here.
   */
  function hook(e, which, ...args) {
    for (const b of e.behaviours) {
      if (typeof b.definition[which] !== 'function') continue
      try { b.definition[which](e, ...args, b.bag) }
      catch (err) { console.error(`[${e.type}:${b.name}] ${which}`, err) }
    }
    if (typeof e._definition?.[which] !== 'function') return
    try { e._definition[which](e, ...args) }
    catch (err) { console.error(`[${e.type}] ${which}`, err) }
  }

  // Keyed by the entity object, so a destroyed body's entry goes with it.
  const previousPlaces = new WeakMap()

  const world = {
    get entities() { return entities },
    types,
    behaviours,
    hook,

    /** Shared game state — score, lives, whatever the game needs across types. */
    state: {},

    /**
     * True once the simulation has moved anything. A level file records where
     * things START, so saving a simulated world would write the player where it
     * happened to land. Set by the loop, cleared by loading a level.
     */
    simulated: false,

    /** Store every body's place before a fixed step moves it. The loop calls this. */
    rememberPlaces() {
      for (const entity of entities) {
        previousPlaces.set(entity, { x: entity.x, y: entity.y, z: entity.z || 0, yaw: entity.yaw })
      }
    },

    /**
     * Where to draw a body: `blend` of the way from its place before the last
     * step to its place now. A body spawned since that step has no earlier place
     * and is drawn where it is. Game code reads `x`, `y` and `z`, never this.
     */
    drawnPlace(entity, blend = 1) {
      const before = previousPlaces.get(entity)
      const z = entity.z || 0
      if (!before || blend >= 1) return { x: entity.x, y: entity.y, z, yaw: entity.yaw }
      const between = (from, to) => from + (to - from) * blend
      return {
        x: between(before.x, entity.x),
        y: between(before.y, entity.y),
        z: between(before.z, z),
        yaw: Number.isFinite(before.yaw) && Number.isFinite(entity.yaw)
          ? before.yaw + Math.atan2(Math.sin(entity.yaw - before.yaw), Math.cos(entity.yaw - before.yaw)) * blend
          : entity.yaw
      }
    },

    /** Put a type definition in the registry, for the next spawn to read. */
    registerType(name, definition) { types.set(name, definition) },

    /**
     * Replace a type's definition and bring every live entity onto it.
     *
     * This is what makes editing a type file take effect without a reload.
     * Entities hold a direct reference to their definition, so re-registering
     * alone would leave everything running the old code — the failure would be
     * "my change did nothing", which is the worst kind to debug.
     *
     * Placement wins over type, always: a per-placement collider, sprite or
     * prop override survives, and everything else follows the file.
     */
    retype(name, definition) {
      types.set(name, definition)
      let moved = 0

      for (const e of entities) {
        if (e.type !== name) continue
        // What this placement said about its mesh, worked out against the OLD
        // definition — so it has to be read before the pointer moves.
        const ownMesh = lookDiff(e.mesh, expand(e._definition.mesh, 'texture'))
        e._definition = definition

        // Re-merge from the new defaults, keeping only what this placement
        // actually overrode. Changing a default in the file then shows up on
        // every entity that never disagreed with it.
        const kept = {}
        for (const k of e.overrides) kept[k] = e.properties[k]
        e.properties = { ...(definition.properties || {}), ...kept }

        if (!e._setByPlacement.sprite) e.sprite = expand(definition.sprite, 'image')
        // Merge, not replace: changing a texture in the type file reaches every
        // wall that never disagreed with it, while a wall that set its own box
        // keeps that box.
        e.mesh = mergeLook(definition.mesh, ownMesh, 'texture')
        if (!e._setByPlacement.collider) e.collider = definition.collider ?? null
        syncTypeBehaviours(e, definition)
        moved++
      }

      bus.emit('type:changed', { name, entities: moved })
      return moved
    },

    /** Remove a type. Live entities keep their `_definition`, so they keep working. */
    unregisterType(name) {
      types.delete(name)
      bus.emit('type:changed', { name, removed: true })
    },

    // ---------------------------------------------------------- behaviours
    /** Put a behaviour definition in the registry, for the next attach to read. */
    registerBehaviour(name, definition) { behaviours.set(name, definition) },

    /**
     * retype's counterpart: re-point every live user at the new definition.
     *
     * Running state the behaviour put in its own bag is preserved, unlike a
     * type's properties. Losing it mid-play turns a working `e.float.base` into
     * undefined, and the symptom is NaN on screen rather than an error — which
     * would make editing a behaviour while it runs feel broken.
     */
    rebehave(name, definition) {
      const old = behaviours.get(name) || {}
      behaviours.set(name, definition)
      let moved = 0

      for (const e of entities) {
        const record = e.behaviours.find(b => b.name === name)
        if (!record || RESERVED.has(name)) continue
        const runtime = Object.fromEntries(
          Object.entries(record.bag).filter(([k]) => !(k in (old.properties || {})))
        )
        const kept = {}
        for (const k of record.overrides) kept[k] = record.bag[k]

        record.definition = definition
        record.error = null
        record.bag = { ...(definition.properties || {}), ...runtime, ...kept }
        e[name] = record.bag
        moved++
      }

      bus.emit('behaviour:changed', { name, entities: moved })
      return moved
    },

    /** The file went away. Entities keep the attachment, marked, so a save keeps it too. */
    unregisterBehaviour(name) {
      behaviours.delete(name)
      for (const e of entities) {
        const record = e.behaviours.find(b => b.name === name)
        if (record) { record.definition = {}; record.error = `no behaviours/${name}.js` }
      }
      bus.emit('behaviour:changed', { name, removed: true })
    },

    /** Attach one to a live entity — the drop, and the CLI verb, both land here. */
    attach(e, name, properties = {}) {
      if (e.behaviours.some(b => b.name === name)) throw new Error(`${e.id} already has "${name}"`)
      if (RESERVED.has(name)) throw new Error(`"${name}" is already an entity field`)
      if (!behaviours.has(name)) throw new Error(`no behaviour "${name}"`)
      e._detached.delete(name)
      const record = addBehaviour(e, name, { own: true, overrides: properties })
      bus.emit('world:changed')
      return record
    },

    /**
     * Take a behaviour off one entity.
     *
     * A behaviour the type declares is recorded as detached, or the next sync
     * from the type file would put it straight back.
     */
    detach(e, name) {
      const i = e.behaviours.findIndex(b => b.name === name)
      if (i < 0) return false
      const [record] = e.behaviours.splice(i, 1)
      if (!record.own) e._detached.add(name)
      delete e[name]
      bus.emit('world:changed')
      return true
    },

    /** Change one behaviour's value on one entity, and remember it was changed here. */
    setBehaviourProp(e, name, key, value) {
      const record = e.behaviours.find(b => b.name === name)
      if (!record) throw new Error(`${e.id} has no "${name}"`)
      record.bag[key] = value
      if (!record.overrides.includes(key)) record.overrides.push(key)
      bus.emit('world:changed')
      return record
    },

    /**
     * Add one entity and announce it.
     *
     * A generated id is checked against the live entities, because a level's
     * ids are position-in-file and stable across loads.
     */
    spawn(typeName, placement) {
      const e = makeEntity(typeName, placement)
      // A generated id must not land on one a level already used, and level ids
      // are stable across reloads, so check rather than trust the counter.
      while (!placement?.id && entities.some(o => o.id === e.id)) e.id = `${typeName}-${nextId++}`
      entities.push(e)
      bus.emit('entity:added', e)
      return e
    },

    /** Remove one entity, run its onDestroy hook, and announce it. */
    destroy(e) {
      const i = entities.indexOf(e)
      if (i < 0) return
      entities.splice(i, 1)
      hook(e, 'onDestroy', world.context)
      bus.emit('entity:removed', e)
    },

    /** The first entity of a type. */
    find(typeName) { return entities.find(e => e.type === typeName) },
    /** Every entity of a type. */
    all(typeName) { return entities.filter(e => e.type === typeName) },
    /** One entity by its level id. */
    byId(id) { return entities.find(e => e.id === id) },

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
     */
    capture() {
      const lost = []
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
    },

    /**
     * Put this world back to a checkpoint.
     *
     * An entity is matched by id and written INTO the object already here rather
     * than replaced. Identity is what everything else holds: the solver maps an
     * entity to a body, a behaviour watches one, a chase remembers one. A restore
     * that handed out new objects would break every one of them, and the symptom
     * would look like a physics bug.
     *
     * @param {object} capture From `capture()`.
     * @returns {object} How many entities went back, and how much was lost.
     */
    restore(capture) {
      if (capture?.version !== CHECKPOINT_VERSION) throw new Error(`checkpoint version ${capture?.version} is not ${CHECKPOINT_VERSION}`)
      const byId = new Map(entities.map(entity => [entity.id, entity]))

      // Every entity is found or made FIRST, with its keys cleared, so that a value
      // pointing at one — a field holding an entity, or the shared state holding
      // one — has something to point at. Resolving references as the fields were
      // assigned would depend on the order the entities happened to be captured in,
      // and would lose any entity the world had destroyed since.
      const rebuilt = capture.entities.map(entry => {
        const fields = entry.fields
        const entity = byId.get(fields.id) || makeEntity(fields.type, { id: fields.id })
        byId.set(fields.id, entity)
        for (const key of Object.keys(entity)) if (key !== '_definition') delete entity[key]
        return { entity, entry }
      })

      for (const { entity, entry } of rebuilt) {
        for (const key of Object.keys(entry.fields)) entity[key] = asValue(entry.fields[key], byId)
        entity._definition = types.get(entity.type) || {}
        entity.behaviours = entry.behaviours.map(record => ({
          name: record.name,
          own: record.own,
          overrides: [...record.overrides],
          error: record.error,
          definition: behaviours.get(record.name) || {},
          bag: asValue(record.bag, byId)
        }))
        for (const record of entity.behaviours) entity[record.name] = record.bag
      }

      entities = rebuilt.map(one => one.entity)
      // The state object keeps its identity: a plugin that read it once still has
      // the same object, holding the values from before.
      for (const key of Object.keys(world.state)) delete world.state[key]
      Object.assign(world.state, asValue(capture.state, byId))
      world.simulated = !!capture.simulated
      bus.emit('world:changed')
      return { entities: entities.length, lost: capture.lost.length }
    },

    /** Empty the world and mark it unsimulated, as loading a level does first. */
    clear() {
      entities = []
      world.simulated = false
      bus.emit('world:cleared')
    },

    /**
     * Serialise back to the level shape.
     *
     * A save must never narrow the file: anything the placement carried that the
     * entity does not model (a per-instance collider, a sprite override) is
     * written straight back out. Overrides stay plain JSON so a diff is readable.
     */
    toLevel(camera) {
      return {
        camera,
        entities: entities.map(e => {
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
  }

  return world
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
  Array.isArray(value) ? value.map(round) : Math.round(value * 1000) / 1000
