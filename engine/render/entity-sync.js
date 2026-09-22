/**
 * Kernel: turning the entity list into scene objects, as cheaply as a frame
 * allows.
 *
 * `sync` visits every entity every frame and the usual frame changes nothing,
 * so the quiet scan answers the unchanged ones and the full pass runs only for
 * what it could not. A playing frame moves everything, so the moving scan
 * answers what only moved.
 */
import {
  meshOf, totalScale, turnRadians, spinRadians, drawSize, entityPlan
} from '../frame-plan.js'
import { anchorOffset, frameWindow } from './entity-look.js'
import { applyAttachments } from './model-nodes.js'

export function makeEntitySync(state) {
  /**
   * What `sync` already knows about one entity, keyed by the entity itself.
   *
   * `sync` used to re-measure and re-stringify everything for every entity on
   * every frame: the look, the turn, the stillness signature. Almost all of that
   * answer is the same one it gave last frame, so it is kept here beside the
   * object it stands for. Keyed by the entity object rather than its id because
   * the id is a string and hashing fifty thousand of them a frame is exactly the
   * cost this exists to remove.
   */
  const records = new WeakMap()

  /** Bumped once per sync; the frame an object was last seen in. */
  let frameCounter = 0


  /**
   * The keyline colour the drawn outlines were built with.
   *
   * An idling entity keeps the outline it already has, so a colour changed on
   * `readability` has to force one full pass to rebuild them.
   */
  let drawnKeylineColour

  /** The default keyline width the drawn outlines were built with. */
  let drawnKeylineWidth

  /** The per-entity frame state, created on first sight. */
  function recordFor(entity) {
    let record = records.get(entity)
    if (record) return record
    record = {
      object: null,
      // True once the merge decision is final for the current look, so a frame
      // that changes nothing can skip the entity entirely.
      settled: false,
      moved: false,
      simple: false,
      idle: false,
      keyline: false,
      haveSignature: false,
      frames: 0,
      sigX: 0, sigY: 0, sigZ: 0,
      sigScale: 1, sigTurnX: 0, sigTurnY: 0, sigTurnZ: 0, sigLook: null,
      turn: null, turnRotation: undefined, turnYaw: undefined,
      turnObject: null, appliedTurnX: NaN, appliedTurnY: NaN, appliedTurnZ: NaN,
      // The plan and the declaration it was measured from, so the per-entity
      // lookup is four identity compares rather than a map keyed by a string.
      plan: null, planMesh: undefined, planSprite: undefined,
      planType: undefined, planCollider: undefined,
      // The look string the object was built with, so a frame that changed
      // nothing compares one record field instead of reaching into `userData`.
      drawnLook: null,
      // The keyline already hanging off this entity's object, and the width and
      // colour it was built with. Read here rather than off `userData`, whose
      // shape grows a new property for every feature the renderer gains.
      keylineMesh: null, keylineWidth: -1, keylineColour: null, keylineReady: false,
      // The batch this entity is in, or null. Mirrors `userData.batch` so the
      // moving path does not have to reach into the object to find out.
      batchKey: null,
      // The declaration, drawn shape and feet-anchor height the last full pass
      // used, so a moving entity that changed nothing else can be placed and
      // shadowed without measuring any of them again.
      declared: null, shape: null, anchor: 0,
      // True when this entity is a simple mesh, out of every batch, whose only
      // per-frame input is its position. `scanMoving` then answers it.
      steady: false,
      // The entity this record answered for last, so the position-indexed array
      // can tell a stable list from a reordered one.
      entity: null,
      // The last local transform this record wrote, and the object it wrote it
      // to. A pose or a look change makes an entity dirty without moving it, so
      // composing the same matrix again would flag the whole model subtree for
      // re-multiplication on every draw. These nine compares keep a still
      // transform from claiming it changed.
      placedObject: null,
      placedX: NaN, placedY: NaN, placedZ: NaN,
      placedRotX: NaN, placedRotY: NaN, placedRotZ: NaN,
      placedScaleX: NaN, placedScaleY: NaN, placedScaleZ: NaN
    }
    records.set(entity, record)
    return record
  }

  /**
   * The record for the entity at one position in the world's list.
   *
   * `sync` walks the list in order, so the position is stable and an array of
   * records is one load instead of a WeakMap probe per entity. The stored entity
   * is the test: a reorder, a spawn or a removal falls back to the WeakMap.
   */
  const recordByIndex = []
  function recordAt(index, entity) {
    const known = recordByIndex[index]
    if (known !== undefined && known.entity === entity) return known
    const record = recordFor(entity)
    record.entity = entity
    recordByIndex[index] = record
    return record
  }

  /** The one object an interpolated place is written into, reused every entity. */
  const drawnPlaceScratch = { x: 0, y: 0, z: 0, yaw: undefined }

  /**
   * The plan for one entity, kept on its record.
   *
   * `entityPlan` is already cached by declaration, but answering it per entity
   * built a `t:<type>` key for every entity with no mesh object — a string per
   * entity per frame. The record holds the four things the plan depends on, so a
   * stable entity answers with identity compares and a string is built only when
   * a declaration actually changed.
   */
  function planFor(entity, record) {
    if (record.plan !== null
        && record.planMesh === entity.mesh && record.planSprite === entity.sprite
        && record.planType === entity.type && record.planCollider === entity.collider) {
      return record.plan
    }
    const plan = entityPlan(entity)
    record.plan = plan
    record.planMesh = entity.mesh
    record.planSprite = entity.sprite
    record.planType = entity.type
    record.planCollider = entity.collider
    return plan
  }

  /**
   * Turn an entity the cheap way while its declaration and angles hold still.
   *
   * `turnRadians` builds a fresh object for every mesh entity every frame. The
   * angles only change when `rotation` or `yaw` does, and those are numbers for
   * almost every entity, so the object is kept and handed back.
   */
  function turnFor(entity, record) {
    if (record.turn && typeof entity.rotation !== 'object'
        && record.turnRotation === entity.rotation && record.turnYaw === entity.yaw) return record.turn
    const turn = turnRadians(entity)
    record.turn = turn
    record.turnRotation = entity.rotation
    record.turnYaw = entity.yaw
    return turn
  }

  /**
   * Recompose an object's local matrix only when its transform really changed.
   *
   * `Object3D.updateMatrix` flags the object so the next scene traversal
   * multiplies its world matrix and forces every descendant to do the same. An
   * entity that is dirty because its pose or look changed must not pay that for
   * the whole subtree, so the last written position, rotation and scale are
   * compared first.
   */
  function placeMatrix(object, record) {
    const px = object.position.x, py = object.position.y, pz = object.position.z
    const rx = object.rotation.x, ry = object.rotation.y, rz = object.rotation.z
    const sx = object.scale.x, sy = object.scale.y, sz = object.scale.z
    if (record.placedObject === object
        && record.placedX === px && record.placedY === py && record.placedZ === pz
        && record.placedRotX === rx && record.placedRotY === ry && record.placedRotZ === rz
        && record.placedScaleX === sx && record.placedScaleY === sy && record.placedScaleZ === sz) return
    record.placedObject = object
    record.placedX = px; record.placedY = py; record.placedZ = pz
    record.placedRotX = rx; record.placedRotY = ry; record.placedRotZ = rz
    record.placedScaleX = sx; record.placedScaleY = sy; record.placedScaleZ = sz
    object.updateMatrix()
    state.shadowDirty = true
  }


  /**
   * One entity's frame state, in one flat array of fixed-size slots.
   *
   * `sync` visits every entity every frame, and the common frame changes
   * nothing: proving that is the whole cost. Parallel arrays — one per field —
   * put one entity's values in a dozen separate regions of the heap, so every
   * visit paid a dozen cache misses for a dozen compares. A slot here holds them
   * together, so one entity is a couple of cache lines, and the array is walked
   * in order. At fifty thousand entities that is most of the scan.
   *
   * A slot belongs to the entity it held last: the first cell is the test. A slot
   * whose entity changed — a spawn, a removal that shifted the rest, a reorder —
   * falls through to the full pass, which rewrites it. The WeakMap record stays
   * the authority for slow-path state; this only answers "is this still the
   * entity the last pass drew".
   */
  const SLOT_STRIDE = 16
  const SLOT_OBJECT = 1
  const SLOT_MESH = 2
  const SLOT_COLLIDER = 3
  const SLOT_TYPE = 4
  const SLOT_X = 5
  const SLOT_Y = 6
  const SLOT_Z = 7
  const SLOT_SCALE = 8
  const SLOT_YAW = 9
  const SLOT_HIDDEN = 10
  const SLOT_OPACITY = 11
  const SLOT_FLAGS = 12
  // What the moving scan needs to place an entity and its contact shadow,
  // copied here so that scan never touches the entity's record: the record is a
  // second heap object per entity and a cache miss the flat array does not pay.
  const SLOT_ANCHOR = 13
  const SLOT_DECLARED = 14
  const SLOT_SHAPE = 15
  /** What the quiet test needs set, and the marks the scan reports. */
  const SLOT_QUIET = 1
  const SLOT_KEYLINE = 2
  const SLOT_STEADY = 4

  const snapshot = []

  /**
   * The place the last frame drew each entity at, as plain doubles.
   *
   * The snapshot above holds objects and numbers in one array, so a fractional
   * position written into it is a heap number — one allocation per entity per
   * frame, which a playing frame then pays to collect. A typed array stores the
   * place unboxed, and the place is the only number a moving frame rewrites on
   * every entity.
   */
  const DRAWN_STRIDE = 3
  let drawnPlaces = new Float64Array(0)

  /** Room for one drawn place per entity, keeping what is already there. */
  function growDrawnPlaces(length) {
    if (drawnPlaces.length >= length * DRAWN_STRIDE) return
    const next = new Float64Array(length * DRAWN_STRIDE)
    next.set(drawnPlaces)
    drawnPlaces = next
  }

  /** Forget slots past the end of the entity list, so a removed entity is not held. */
  function trimSlots(length) {
    snapshot.length = length * SLOT_STRIDE
  }

  /**
   * Record what the full pass just drew for one entity, for the next frame to
   * compare against.
   *
   * `sprite` is deliberately absent. A mesh entity draws from its mesh, and the
   * plan ignores a sprite while one is present, so a changed sprite cannot change
   * what this frame shows and does not have to be compared.
   */
  function saveSlot(index, entity, object, record) {
    const at = index * SLOT_STRIDE
    snapshot[at] = entity
    snapshot[at + SLOT_OBJECT] = object
    snapshot[at + SLOT_MESH] = entity.mesh
    snapshot[at + SLOT_COLLIDER] = entity.collider
    snapshot[at + SLOT_TYPE] = entity.type
    snapshot[at + SLOT_X] = entity.x
    snapshot[at + SLOT_Y] = entity.y
    snapshot[at + SLOT_Z] = entity.z
    snapshot[at + SLOT_SCALE] = entity.scale
    snapshot[at + SLOT_YAW] = entity.yaw
    snapshot[at + SLOT_HIDDEN] = entity.hidden
    snapshot[at + SLOT_OPACITY] = entity.opacity
    snapshot[at + SLOT_ANCHOR] = record.anchor
    snapshot[at + SLOT_DECLARED] = record.declared
    snapshot[at + SLOT_SHAPE] = record.shape
    const drawn = index * DRAWN_STRIDE
    drawnPlaces[drawn] = entity.x
    drawnPlaces[drawn + 1] = entity.y
    drawnPlaces[drawn + 2] = entity.z
    // Settled, idle and never moved: the answers that let the next frame skip
    // this entity, and whether it draws an outline while skipped. Steady is the
    // moving counterpart: a simple mesh, out of every batch, whose outline is
    // already resolved, so a frame that only moved it needs to write a place.
    snapshot[at + SLOT_FLAGS] =
      (record.settled && record.idle && !record.moved ? SLOT_QUIET : 0)
      | (record.keyline ? SLOT_KEYLINE : 0)
      | (record.steady ? SLOT_STEADY : 0)
  }

  /**
   * Whether the entity in slot `at` is the one the last full pass drew, has
   * never moved, and has not changed since. Such an entity is drawn exactly as
   * it was, on a still frame and on a playing frame alike.
   */
  function isQuiet(entity, at, ringedId) {
    return snapshot[at] === entity
      && (snapshot[at + SLOT_FLAGS] & SLOT_QUIET) !== 0
      && typeof entity.rotation !== 'object'
      && snapshot[at + SLOT_MESH] === entity.mesh
      && snapshot[at + SLOT_COLLIDER] === entity.collider
      && snapshot[at + SLOT_TYPE] === entity.type
      && snapshot[at + SLOT_X] === entity.x
      && snapshot[at + SLOT_Y] === entity.y
      && snapshot[at + SLOT_Z] === entity.z
      && snapshot[at + SLOT_SCALE] === entity.scale
      && snapshot[at + SLOT_YAW] === entity.yaw
      && snapshot[at + SLOT_HIDDEN] === entity.hidden
      && snapshot[at + SLOT_OPACITY] === entity.opacity
      && (ringedId === null || (entity.id !== ringedId && entity.type !== ringedId))
  }

  /** The entities the quiet scan could not answer, filled by `scanQuiet`. */
  const dirtyIndices = []

  /**
   * The per-entity cost of a still frame, in a function of its own.
   *
   * Every entity that did not change is answered here and never reaches the full
   * pass. This is the hot loop, and it is deliberately small: V8 optimizes a
   * function as one unit, and the same compares inlined into `sync` are large
   * enough to be left in the interpreter, which costs about three times as much.
   *
   * Returns how many quiet entities draw an outline, and leaves the indices of
   * everything else in `dirtyIndices`.
   */
  function scanQuiet(entities, frame, sweep, ringedId) {
    dirtyIndices.length = 0
    let keylines = 0
    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i]
      const at = i * SLOT_STRIDE
      if (isQuiet(entity, at, ringedId)) {
        if (sweep) snapshot[at + SLOT_OBJECT].userData.seen = frame
        if (snapshot[at + SLOT_FLAGS] & SLOT_KEYLINE) keylines++
        continue
      }
      dirtyIndices.push(i)
    }
    return keylines
  }

  /**
   * The per-entity cost of a playing frame, in a function of its own.
   *
   * A playing frame moves every entity and draws it between its last two steps,
   * so the quiet scan cannot answer it. Almost every one of those entities is
   * the same thing it was last frame except for its place: same declaration,
   * same turn, same scale, same outline. This scan writes the interpolated
   * place and the contact shadow that follows it, and leaves everything else
   * exactly as the last full pass left it. Whatever it cannot answer goes to
   * the full pass through `dirtyIndices`.
   */
  function scanMoving(entities, blend, drawInto, ringedId) {
    dirtyIndices.length = 0
    let keylines = 0
    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i]
      const at = i * SLOT_STRIDE
      const drawn = i * DRAWN_STRIDE
      const flags = snapshot[at + SLOT_FLAGS]
      // A level in play is mostly things that never move. Their place before
      // the step is their place now, so they are drawn as the last pass left them.
      if (isQuiet(entity, at, ringedId)) {
        if (flags & SLOT_KEYLINE) keylines++
        continue
      }
      if (snapshot[at] === entity
          && (flags & SLOT_STEADY) !== 0
          && typeof entity.rotation !== 'object'
          && snapshot[at + SLOT_MESH] === entity.mesh
          && snapshot[at + SLOT_COLLIDER] === entity.collider
          && snapshot[at + SLOT_TYPE] === entity.type
          && (drawnPlaces[drawn] !== entity.x
            || drawnPlaces[drawn + 1] !== entity.y
            || drawnPlaces[drawn + 2] !== entity.z)
          && snapshot[at + SLOT_SCALE] === entity.scale
          && snapshot[at + SLOT_YAW] === entity.yaw
          && snapshot[at + SLOT_HIDDEN] === entity.hidden
          && snapshot[at + SLOT_OPACITY] === entity.opacity
          && (ringedId === null || (entity.id !== ringedId && entity.type !== ringedId))) {
        const place = drawInto(drawnPlaceScratch, entity, blend)
        const object = snapshot[at + SLOT_OBJECT]
        object.position.set(place.x, place.y + snapshot[at + SLOT_ANCHOR], place.z || 0)
        // The record keeps the last transform written so a later full pass can
        // tell a real move from a pose change; this fast path moves the object,
        // so it writes through the same bookkeeping rather than around it.
        placeMatrix(object, object.userData.record)
        // The keyline hangs off the object and moves with it, so only the
        // ground mark has to be written again.
        if (!entity.hidden) {
          state.noteContactShadow(entity, snapshot[at + SLOT_DECLARED], snapshot[at + SLOT_SHAPE], true, place)
        }
        drawnPlaces[drawn] = entity.x
        drawnPlaces[drawn + 1] = entity.y
        drawnPlaces[drawn + 2] = entity.z
        if (flags & SLOT_KEYLINE) keylines++
        continue
      }
      dirtyIndices.push(i)
    }
    return keylines
  }

  /**
   * Draw one entity the quiet scan could not answer: it moved, or its look
   * changed, so every field is read and written.
   *
   * Returns 1 when the entity draws an outline, 0 when it does not. This is its
   * own function because `sync` is large enough that V8 leaves it in the
   * baseline tier, where nothing it calls is inlined; the per-entity loop is the
   * whole cost of a playing frame, so it lives where it can be optimized.
   */
  function syncEntity(i, entity, frame, sweep, blend, settledFrame, drawInto, drawPlace, painters) {
    const record = recordAt(i, entity)
    const plan = planFor(entity, record)
    const described = plan.described
    const object = state.objectFor(entity, described, record)
    if (sweep) object.userData.seen = frame
    const place = settledFrame ? entity
      : drawInto ? drawInto(drawnPlaceScratch, entity, blend)
      : drawPlace ? drawPlace(entity, blend)
      : entity
    const declared = entity.mesh ? meshOf(entity) : null
    const anchor = declared?.anchor == null ? 0 : anchorOffset(entity)
    record.declared = declared
    record.anchor = anchor
    object.position.set(place.x, place.y + anchor, place.z || 0)
    object.visible = !entity.hidden

    if (entity.mesh) {
      const shape = plan.shape
      record.shape = shape
      // Solid geometry carries its own size, so scale multiplies rather
      // than sets.
      const s = totalScale(entity)
      object.scale.set(s, s, s)
      // One turn, read once and passed on: the merge signature needs the
      // same three angles, and reading them twice was two allocations a
      // mesh entity a frame.
      const turn = turnFor(entity, record)
      const yaw = Number.isFinite(place.yaw) ? place.yaw : turn.y
      // A static thing that kept its angles must not rebuild its quaternion
      // every frame; only a changed turn is written.
      if (record.turnObject !== object || record.appliedTurnX !== turn.x
          || record.appliedTurnY !== yaw || record.appliedTurnZ !== turn.z) {
        object.rotation.set(turn.x, yaw, turn.z, 'YXZ')
        record.turnObject = object
        record.appliedTurnX = turn.x
        record.appliedTurnY = yaw
        record.appliedTurnZ = turn.z
      }
      // The editor dims a hovered entity to preview it.
      const opacity = entity.opacity ?? 1
      state.dim(object, opacity)
      // A named part of a body built from boxes poses exactly as a named
      // node of a model does, so a run cycle is the same four numbers
      // either way and game code never asks which the body is made of.
      if (entity.pose && (declared.model || declared.parts)) state.applyPose(object, entity.pose)
      // Unconditional for a model, because taking an attachment off is as
      // much a state as putting one on: a body that dropped its rifle stops
      // declaring one, and the hand has to empty.
      if (declared.model) applyAttachments(object, entity.attachments, state.release)
      // Depth decides what covers what, so there is nothing to order.
      object.renderOrder = 0
      record.simple = !declared.model && !Array.isArray(declared.parts)
      record.idle = record.simple && declared.shadow === undefined && declared.ring === undefined
      state.considerForMerging(entity, object, described, opacity, !record.simple, turn, record)
      // After merging, which is where "has this ever moved" is answered.
      record.keyline = state.updateReadability(entity, object, declared, shape, record.moved, place, record)
      // What `scanMoving` reads next frame to place this entity without
      // measuring it again. Only a simple mesh that is in no batch and whose
      // outline is already drawn can be answered that cheaply — a ring or a
      // pose is a mark or a transform this scan does not write.
      record.steady = record.simple && record.batchKey === null && record.keylineReady
        && declared.ring === undefined && entity.pose === undefined
      placeMatrix(object, record)
      saveSlot(i, entity, object, record)
      return record.keyline ? 1 : 0
    }

    record.simple = false
    record.idle = false
    record.steady = false
    const { w, h } = drawSize(entity)
    object.rotation.set(0, 0, spinRadians(entity))
    object.scale.set(w, h, 1)
    object.material.opacity = entity.opacity ?? 1
    // Painter's order is the layering in 2D: z first, then the order the
    // level lists them in. In a first-person scene the world in front is
    // real geometry, so a sprite has to be tested against it.
    object.renderOrder = (entity.z || 0) * 1000 + i
    object.material.depthTest = !painters

    // A tiled sprite repeats once per world unit unless told otherwise.
    if (entity.sprite?.tile && object.material.map) {
      object.material.map.repeat.set(w / entity.sprite.tile, h / entity.sprite.tile)
    }

    // A sheet shows one cell. `entity.frame` is set by whoever is animating
    // it — the animation plugin, or game code directly.
    const image = object.material.map?.image
    if (entity.sprite?.sheet && image?.width) {
      const win = frameWindow(entity.sprite, entity.frame, image)
      object.material.map.repeat.set(win.repeat[0], win.repeat[1])
      object.material.map.offset.set(win.offset[0], win.offset[1])
    }

    // Facing is a mirror, not a rotation: negative X scale flips the art
    // without touching the collider or the transform gizmo.
    if (entity.flip) object.scale.x = -object.scale.x
    placeMatrix(object, record)
    saveSlot(i, entity, object, record)
    return 0
  }

  /**
   * Walk the entities the quiet scan could not answer.
   *
   * The loop is here rather than in `sync` so the function V8 has to optimize
   * stays small; a loop that large kept `sync` deoptimizing once a frame, which
   * left the per-entity call in the interpreter.
   */
  function syncChanged(entities, indices, count, frame, sweep, blend, settledFrame, drawInto, drawPlace, painters) {
    let keylines = 0
    for (let c = 0; c < count; c++) {
      const i = indices === null ? c : indices[c]
      keylines += syncEntity(i, entities[i], frame, sweep, blend, settledFrame, drawInto, drawPlace, painters)
    }
    return keylines
  }

  function sync(world, blend = 1) {
    const painters = state.flat()
    const frame = ++frameCounter
    state.beginMarks()
    let keylines = 0

    // A body is drawn at `world.drawnPlace` only between two fixed steps. At
    // blend 1 that place is the entity itself, so reading it directly saves an
    // object per entity per frame — and lets an entity that did not change at
    // all be skipped below. The playing path writes the blended place into one
    // object reused for every entity, so a moving frame allocates nothing.
    const settledFrame = blend >= 1
    const drawInto = settledFrame ? null : (world.drawnPlaceInto || null)
    const drawPlace = settledFrame ? null : (world.drawnPlace || null)
    // A changed default outline colour or width has to reach the outlines
    // already drawn, and nothing else on `readability` applies to an entity
    // that has never moved and declares no mark.
    const marksChanged = state.readability.keylineColour !== drawnKeylineColour
      || state.readability.keyline !== drawnKeylineWidth
    drawnKeylineColour = state.readability.keylineColour
    drawnKeylineWidth = state.readability.keyline
    // The one entity named by the ring rule. Everything else that is never
    // moved and declares no mark can be left exactly as it was last frame.
    const ringRule = state.readability.ring
    const ringedId = ringRule === 'followed'
      ? (state.view.mode === 'first-person' ? null : state.view.follows ?? null)
      : (typeof ringRule === 'string' ? ringRule : null)

    const entities = world.entities
    // One object stands for every entity, so equal counts mean nothing has
    // died. Then no object needs a seen marker and the sweep at the end is
    // skipped; `objectsGrew` catches an id swapped for a fresh one.
    const sweep = state.meshes.size !== entities.length
    state.objectsGrew = false
    // A shorter list means entities went; drop their slots so nothing is held.
    if (snapshot.length > entities.length * SLOT_STRIDE) trimSlots(entities.length)
    growDrawnPlaces(entities.length)
    state.growShadowData(entities.length)

    // A still frame changes nothing, so the quiet scan answers it in a function
    // of its own and the full pass runs only for what the scan could not answer.
    // A playing frame moves everything, so the moving scan answers what only
    // moved; the full pass is left for the first frame, a list that changed
    // under it, or an entity whose look did.
    let scanned = null
    if (settledFrame && !marksChanged) scanned = scanQuiet(entities, frame, sweep, ringedId)
    else if (!sweep && drawInto) scanned = scanMoving(entities, blend, drawInto, ringedId)
    if (scanned !== null) keylines = scanned
    const changed = scanned === null ? entities.length : dirtyIndices.length
    keylines += syncChanged(entities, scanned === null ? null : dirtyIndices, changed, frame, sweep,
      blend, settledFrame, drawInto, drawPlace, painters)

    // A sweep only when the counts disagree. When they agree but a fresh id
    // was built during the loop, the living set is rebuilt once instead; the
    // markers were not written on that path.
    if (sweep) {
      for (const [id, object] of state.meshes) {
        if (object.userData.seen === frame) continue
        state.leaveBatch(id)
        state.discard(object)
        state.meshes.delete(id)
      }
    } else if (state.objectsGrew) {
      const living = new Set()
      for (let i = 0; i < entities.length; i++) living.add(entities[i].id)
      for (const [id, object] of state.meshes) {
        if (living.has(id)) continue
        state.leaveBatch(id)
        state.discard(object)
        state.meshes.delete(id)
      }
    }

    state.rebuildBatches()
    state.placeContactShadows()
    state.placeGroundRings()

    state.stats.entities = world.entities.length
    state.stats.keylines = keylines
    // Counted after the rebuild, from the batches that actually drew; see
    // `batchStats` for why a batch with no merged geometry does not count.
    const marks = state.markCounts()
    state.stats.contactShadows = marks.contactShadows
    state.stats.groundRings = marks.groundRings
    const counted = state.batchStats()
    state.stats.merged = counted.merged
    state.stats.batches = counted.batches
    state.stats.materials = state.materialCount()
  }

  state.sync = sync
}
