/**
 * Kernel: the entity store, the type and behaviour registries, and the hooks
 * that run them.
 *
 * An entity is flat. Position lives on the entity, not on a Transform that lives
 * on the entity: e.x, not e.transform.position.x.
 *
 * The one form of composition is a *behaviour*: a file shaped exactly like a
 * type, minus the art, that a type or a single placement can attach by name.
 * It is deliberately not a component system — a behaviour cannot be queried,
 * cannot find another behaviour, and has no lifecycle beyond the same four
 * hooks everything else has. All it can do is read and write the entity.
 *
 * `stateHash` reads the store. The look and merge vocabulary is in
 * `world-look.js`; the checkpoint projection and the level shape are in
 * `world-state.js`.
 */
import { HANDLED, RESERVED, asAttached, expand, mergeLook, lookDiff } from './world-look.js'
import { captureWorld, restoreWorld, levelFromWorld } from './world-state.js'

let nextId = 1

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
/** Fold a list, walking every item so a vector is not one constant. */
const foldList = (hash, list, depth) => {
  let out = fold(hash, LIST ^ list.length)
  for (const item of list) out = foldValue(out, item, depth + 1)
  return out
}

/** Fold a record by sorted key, so the order a plugin set them does not change the answer. */
const foldRecord = (hash, value, depth) => {
  let out = fold(hash, RECORD)
  for (const key of Object.keys(value).sort()) out = foldValue(foldText(out, key), value[key], depth + 1)
  return out
}

/** A list or a record, whichever this is. */
const foldComplex = (hash, value, depth) => {
  if (Array.isArray(value)) return foldList(hash, value, depth)
  return foldRecord(hash, value, depth)
}

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
  const kind = typeof value
  if (value === null) return fold(hash, NOTHING)
  if (kind === 'number') return foldNumber(hash, value)
  if (kind === 'string') return foldText(hash, value)
  if (kind === 'boolean') return fold(hash, value ? 1 : 2)
  if (value === undefined) return fold(hash, ABSENT)
  if (depth >= DEPTH) return fold(hash, OTHER)
  if (kind === 'object') return foldComplex(hash, value, depth)
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
  /** The id a placement asks for, or the next generated one for its type. */
  function entityIdFor(typeName, placement) {
    return placement.id || `${typeName}-${nextId++}`
  }

  /** Where and how big the entity is, from the placement's own numbers. */
  function entityPlacementFor(typeName, placement) {
    const at = placement.at || [0, 0, 0]
    return {
      id: entityIdFor(typeName, placement),
      type: typeName,
      x: at[0] ?? 0,
      y: at[1] ?? 0,
      z: at[2] ?? 0,
      rotation: placement.rotation ?? 0,
      scale: placement.scale ?? 1
    }
  }

  /**
   * What the entity draws with.
   *
   * The 3D counterpart of `sprite`: solid geometry rather than a textured plane.
   * A thing declares one or the other, never both — `mesh` is what the renderer
   * draws when it is there. It merges rather than replaces, so a placement can
   * change the box without restating the material.
   */
  function entityLookFor(type, placement) {
    return {
      sprite: expand(placement.sprite ?? type.sprite, 'image'),
      mesh: mergeLook(type.mesh, placement.mesh, 'texture'),
      collider: placement.collider ?? type.collider ?? null
    }
  }

  /** Type defaults with the placement's own values over the top; overrides stay visible. */
  function entityPropertiesFor(type, placement) {
    return {
      properties: { ...(type.properties || {}), ...(placement.properties || {}) },
      overrides: Object.keys(placement.properties || {})
    }
  }

  /** Which of the look's fields this placement set for itself, so a type reload leaves them alone. */
  function entitySetByPlacement(placement) {
    return {
      _setByPlacement: {
        sprite: placement.sprite !== undefined,
        mesh: placement.mesh !== undefined,
        collider: placement.collider !== undefined
      }
    }
  }

  /**
   * Anything the placement carried that the entity does not model directly.
   *
   * Kept so a save round-trips the file rather than silently narrowing it.
   */
  function entityExtraKeys(placement) {
    return {
      _extraKeys: Object.fromEntries(Object.entries(placement).filter(([key]) => !HANDLED.has(key)))
    }
  }

  /**
   * Give the entity the behaviours its type and its placement name.
   *
   * The order is the type's first, then the placement's. A name the placement
   * took off is recorded rather than forgotten, or the next load puts it back.
   */
  function attachPlacementBehaviours(entity, type, placement) {
    const fromType = asAttached(type.behaviours)
    const fromPlacement = asAttached(placement.behaviours)
    for (const name of [...Object.keys(fromType), ...Object.keys(fromPlacement)]) {
      if (entity.behaviours.some(behaviour => behaviour.name === name)) continue
      if (fromPlacement[name] === false) {
        entity._detached.add(name)
        continue
      }
      addBehaviour(entity, name, {
        own: !(name in fromType),
        typeProps: fromType[name] || {},
        overrides: fromPlacement[name] || {}
      })
    }
  }

  /**
   * Build one entity from a placement, filling in the type's defaults.
   *
   * The type is read once here and kept as `_definition`, so a later edit can
   * find every entity still running the old one — see `retype`.
   */
  function makeEntity(typeName, placement = {}) {
    const type = types.get(typeName) || {}
    const entity = {
      ...entityPlacementFor(typeName, placement),
      ...entityLookFor(type, placement),
      ...entityPropertiesFor(type, placement),
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
      ...entitySetByPlacement(placement),
      ...entityExtraKeys(placement)
    }
    attachPlacementBehaviours(entity, type, placement)
    return entity
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
      try {
        b.definition[which](e, ...args, b.bag)
      } catch (err) {
        console.error(`[${e.type}:${b.name}] ${which}`, err)
      }
    }
    if (typeof e._definition?.[which] !== 'function') return
    try {
      e._definition[which](e, ...args)
    } catch (err) {
      console.error(`[${e.type}] ${which}`, err)
    }
  }

  /**
   * Where a body was before the last step, kept on the body itself.
   *
   * A non-enumerable symbol, so `Object.keys`, a save, a checkpoint copy and a
   * spread all pass over it — a place between steps is runtime state and
   * nothing serialises it. It used to be a `WeakMap`, and a probe plus a write
   * for every entity every step was a third of the step at fifty thousand
   * entities.
   */
  const beforePlace = Symbol('before place')

  /**
   * Write the place between two steps into `target` rather than a new object.
   *
   * A body with no earlier place, or a blend of one, is drawn where it is.
   */
  function drawnPlaceInto(target, entity, blend) {
    const before = entity[beforePlace]
    const z = entity.z || 0
    if (!before || blend >= 1) {
      target.x = entity.x
      target.y = entity.y
      target.z = z
      target.yaw = entity.yaw
      return target
    }
    target.x = before.x + (entity.x - before.x) * blend
    target.y = before.y + (entity.y - before.y) * blend
    target.z = before.z + (z - before.z) * blend
    target.yaw =
      Number.isFinite(before.yaw) && Number.isFinite(entity.yaw)
        ? before.yaw + Math.atan2(Math.sin(entity.yaw - before.yaw), Math.cos(entity.yaw - before.yaw)) * blend
        : entity.yaw
    return target
  }

  const world = {
    get entities() {
      return entities
    },
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
      const list = entities
      for (let index = 0; index < list.length; index++) {
        const entity = list[index]
        // The before place lives on the entity, reused rather than replaced: a
        // fresh object — or a map probe — for every entity every step is what
        // stopped a large level running smoothly. Non-enumerable, so nothing
        // that copies or saves an entity sees it.
        let before = entity[beforePlace]
        if (before === undefined) {
          before = {}
          Object.defineProperty(entity, beforePlace, { value: before, writable: true, configurable: true })
        }
        before.x = entity.x
        before.y = entity.y
        before.z = entity.z || 0
        before.yaw = entity.yaw
      }
    },

    /**
     * Where to draw a body: `blend` of the way from its place before the last
     * step to its place now. A body spawned since that step has no earlier place
     * and is drawn where it is. Game code reads `x`, `y` and `z`, never this.
     */
    drawnPlace(entity, blend = 1) {
      return drawnPlaceInto({}, entity, blend)
    },

    /**
     * The same answer, written into `target`.
     *
     * The renderer asks this for every moving entity every frame, and returning
     * a fresh object each time spread fifty thousand short-lived objects through
     * the heap per frame. `drawnPlace` is this plus the one object it returns.
     */
    drawnPlaceInto(target, entity, blend = 1) {
      return drawnPlaceInto(target, entity, blend)
    },

    /** Put a type definition in the registry, for the next spawn to read. */
    registerType(name, definition) {
      types.set(name, definition)
    },

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
    registerBehaviour(name, definition) {
      behaviours.set(name, definition)
    },

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
        const runtime = Object.fromEntries(Object.entries(record.bag).filter(([k]) => !(k in (old.properties || {}))))
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
        if (record) {
          record.definition = {}
          record.error = `no behaviours/${name}.js`
        }
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
    find(typeName) {
      return entities.find(e => e.type === typeName)
    },
    /** Every entity of a type. */
    all(typeName) {
      return entities.filter(e => e.type === typeName)
    },
    /** One entity by its level id. */
    byId(id) {
      return entities.find(e => e.id === id)
    },

    /** Everything about this world a checkpoint has to carry. Built in `world-state.js`. */
    capture() {
      return captureWorld(world)
    },

    /** Put this world back to a checkpoint. Built in `world-state.js`. */
    restore(capture) {
      const restored = restoreWorld(world, capture, makeEntity)
      entities = restored.entities
      bus.emit('world:changed')
      return { entities: entities.length, lost: restored.lost }
    },

    /** Empty the world and mark it unsimulated, as loading a level does first. */
    clear() {
      entities = []
      world.simulated = false
      bus.emit('world:cleared')
    },

    /** Serialise back to the level shape. Built in `world-state.js`. */
    toLevel(camera) {
      return levelFromWorld(world, camera)
    }
  }

  return world
}
