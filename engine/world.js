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

export function makeWorld(bus) {
  let entities = []
  const types = new Map()
  const behaviours = new Map()

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

    unregisterType(name) {
      types.delete(name)
      bus.emit('type:changed', { name, removed: true })
    },

    // ---------------------------------------------------------- behaviours
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

    spawn(typeName, placement) {
      const e = makeEntity(typeName, placement)
      // A generated id must not land on one a level already used, and level ids
      // are stable across reloads, so check rather than trust the counter.
      while (!placement?.id && entities.some(o => o.id === e.id)) e.id = `${typeName}-${nextId++}`
      entities.push(e)
      bus.emit('entity:added', e)
      return e
    },

    destroy(e) {
      const i = entities.indexOf(e)
      if (i < 0) return
      entities.splice(i, 1)
      hook(e, 'onDestroy', world.context)
      bus.emit('entity:removed', e)
    },

    find(typeName) { return entities.find(e => e.type === typeName) },
    all(typeName) { return entities.filter(e => e.type === typeName) },
    byId(id) { return entities.find(e => e.id === id) },

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

const round = n => Math.round(n * 1000) / 1000
