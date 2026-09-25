/**
 * Kernel: turning the entity list into scene objects, as cheaply as a frame
 * allows.
 *
 * Per-entity state is in `entity-record.js` and the quiet snapshot and the two
 * scans over it are in `entity-scan.js`. This file owns the sync pass: the walk
 * that draws what changed, the sweep that drops what left, and the frame's
 * counts.
 */
import { meshOf, totalScale, spinRadians, entityDrawSize } from '../frame-plan.js'
import { anchorOffset, frameWindow } from './entity-look.js'
import { applyAttachments } from './model-nodes.js'
import { applyReach } from './model-reach.js'
import { makeEntityRecords } from './entity-record.js'
import { makeEntityScans } from './entity-scan.js'

/** Build the sync pass: walk the entities that changed, sweep the ones that left, and count the frame. */
export function makeEntitySync(state) {
  const records = makeEntityRecords(state)
  const scans = makeEntityScans(state, records)
  const { recordAt, planFor, turnFor, placeMatrix, drawnPlaceScratch } = records
  const { scanQuiet, scanMoving, dirtyIndices, growDrawnPlaces, trimSlots, saveSlot } = scans

  /** Bumped once per sync; the frame an object was last seen in. */
  let frameCounter = 0

  /** Where this frame draws one entity: itself at blend 1, its interpolated place otherwise. */
  function placeFor(entity, blend, settledFrame, drawInto, drawPlace) {
    if (settledFrame) return entity
    if (drawInto) return drawInto(drawnPlaceScratch, entity, blend)
    if (drawPlace) return drawPlace(entity, blend)
    return entity
  }

  /**
   * Write the object's turn only when it changed.
   *
   * A static thing that kept its angles must not rebuild its quaternion every
   * frame.
   */
  function applyTurn(object, record, turn, yaw) {
    if (
      record.turnObject === object &&
      record.appliedTurnX === turn.x &&
      record.appliedTurnY === yaw &&
      record.appliedTurnZ === turn.z
    )
      return
    object.rotation.set(turn.x, yaw, turn.z, 'YXZ')
    record.turnObject = object
    record.appliedTurnX = turn.x
    record.appliedTurnY = yaw
    record.appliedTurnZ = turn.z
  }

  /** Whether a mesh declaration is one solid shape, rather than a model or a box list. */
  function isSimpleMesh(declared) {
    return !declared.model && !Array.isArray(declared.parts)
  }

  /** Whether the entity is still and declares no mark, so the quiet scan can skip it. */
  function isIdleMesh(entity, declared, simple) {
    return simple && !state.holdsMark(entity, declared)
  }

  /**
   * Whether the moving scan can place this entity without measuring it again.
   *
   * Only a simple mesh that is in no batch, whose marks are settled, and that
   * declares nothing a mark must see on the full pass — a pose is a transform
   * that scan does not write.
   */
  function isSteady(entity, declared, record) {
    return (
      record.simple &&
      record.batchKey === null &&
      record.markReady !== false &&
      !state.holdsMovingMark(entity, declared) &&
      entity.pose === undefined
    )
  }

  /** Draw one entity from its mesh. Returns 1 when it draws an outline, 0 when it does not. */
  function syncMeshEntity(index, entity, object, record, place, plan) {
    const shape = plan.shape
    const described = plan.described
    const declared = meshOf(entity)
    record.shape = shape
    // Solid geometry carries its own size, so scale multiplies rather than sets.
    const scale = totalScale(entity)
    object.scale.set(scale, scale, scale)
    // One turn, read once and passed on: the merge signature needs the same
    // three angles, and reading them twice was two allocations a mesh entity a
    // frame.
    const turn = turnFor(entity, record)
    const yaw = Number.isFinite(place.yaw) ? place.yaw : turn.y
    applyTurn(object, record, turn, yaw)
    // The editor dims a hovered entity to preview it.
    const opacity = entity.opacity ?? 1
    state.dim(object, opacity)
    // A named part of a body built from boxes poses exactly as a named node of
    // a model does, so a run cycle is the same four numbers either way and game
    // code never asks which the body is made of.
    if (entity.pose && (declared.model || declared.parts)) state.applyPose(object, entity.pose)
    // Unconditional for a model, because taking an attachment off is as much a
    // state as putting one on: a body that dropped its rifle stops declaring
    // one, and the hand has to empty.
    if (declared.model) applyAttachments(object, entity.attachments, state.release)
    // After attachments, so a limb can reach for one where it hangs this frame.
    if (declared.model && entity.rigReach) applyReach(object, entity.rigReach)
    // Depth decides what covers what, so there is nothing to order.
    object.renderOrder = 0
    record.simple = isSimpleMesh(declared)
    record.idle = isIdleMesh(entity, declared, record.simple)
    state.considerForMerging(entity, object, described, turn, record)
    // Marks run after merging, which is where "has this ever moved" is answered.
    // A mark that draws a persistent outline sets `record.outline`; clear it first.
    record.outline = false
    state.drawMarks(entity, object, place, declared, record)
    record.steady = isSteady(entity, declared, record)
    placeMatrix(object, record)
    saveSlot(index, entity, object, record)
    return record.outline ? 1 : 0
  }

  /** A tiled sprite repeats once per world unit unless told otherwise. */
  function applySpriteTile(object, entity, width, height) {
    if (!entity.sprite?.tile || !object.material.map) return
    object.material.map.repeat.set(width / entity.sprite.tile, height / entity.sprite.tile)
  }

  /**
   * A sheet shows one cell. `entity.frame` is set by whoever is animating it —
   * the animation plugin, or game code directly.
   */
  function applySheetFrame(object, entity) {
    const image = object.material.map?.image
    if (!entity.sprite?.sheet || !image?.width) return
    const window = frameWindow(entity.sprite, entity.frame, image)
    object.material.map.repeat.set(window.repeat[0], window.repeat[1])
    object.material.map.offset.set(window.offset[0], window.offset[1])
  }

  /** Draw one entity from its sprite. A sprite never draws an outline. */
  function syncSpriteEntity(index, entity, object, record, painters) {
    const { w, h } = entityDrawSize(entity)
    object.rotation.set(0, 0, spinRadians(entity))
    object.scale.set(w, h, 1)
    object.material.opacity = entity.opacity ?? 1
    // Painter's order is the layering in 2D: z first, then the order the level
    // lists them in. In a first-person scene the world in front is real
    // geometry, so a sprite has to be tested against it.
    object.renderOrder = (entity.z || 0) * 1000 + index
    object.material.depthTest = !painters
    applySpriteTile(object, entity, w, h)
    applySheetFrame(object, entity)
    // Facing is a mirror, not a rotation: negative X scale flips the art
    // without touching the collider or the transform gizmo.
    if (entity.flip) object.scale.x = -object.scale.x
    placeMatrix(object, record)
    saveSlot(index, entity, object, record)
    return 0
  }

  /**
   * Draw one entity the quiet scan could not answer: it moved, or its look
   * changed, so every field is read and written.
   *
   * Returns 1 when the entity draws an outline, 0 when it does not. This is its
   * own function because `sync` is large enough that V8 leaves it in the
   * baseline tier, where nothing it calls is inlined; the per-entity loop is the
   * whole cost of a playing frame, so it stays where it can be optimized.
   */
  function syncEntity(pass, index, entity) {
    const record = recordAt(index, entity)
    const plan = planFor(entity, record)
    const described = plan.described
    const object = state.objectFor(entity, described, record)
    if (pass.sweep) object.userData.seen = pass.frame
    const place = placeFor(entity, pass.blend, pass.settledFrame, pass.drawInto, pass.drawPlace)
    const declared = entity.mesh ? meshOf(entity) : null
    const anchor = declared?.anchor == null ? 0 : anchorOffset(entity)
    record.declared = declared
    record.anchor = anchor
    object.position.set(place.x, place.y + anchor, place.z || 0)
    object.visible = !entity.hidden
    if (entity.mesh) return syncMeshEntity(index, entity, object, record, place, plan)
    return syncSpriteEntity(index, entity, object, record, pass.painters)
  }

  /**
   * Walk the entities the quiet scan could not answer.
   *
   * The loop is here rather than in `sync` so the function V8 has to optimize
   * stays small; a loop that large kept `sync` deoptimizing once a frame, which
   * left the per-entity call in the interpreter.
   */
  function syncChanged(pass, indices, count) {
    let keylines = 0
    for (let counted = 0; counted < count; counted++) {
      const index = indices === null ? counted : indices[counted]
      keylines += syncEntity(pass, index, pass.entities[index])
    }
    return keylines
  }

  /**
   * What the frame's scans need before they run.
   *
   * A body is drawn at `world.drawnPlace` only between two fixed steps. At
   * blend 1 that place is the entity itself, so reading it directly saves an
   * object per entity per frame — and lets an entity that did not change at all
   * be skipped. The playing path writes the blended place into one object
   * reused for every entity, so a moving frame allocates nothing.
   */
  function preparePass(world, blend, frame, ringedId, marksChanged, painters) {
    const settledFrame = blend >= 1
    return {
      entities: world.entities,
      blend,
      frame,
      ringedId,
      marksChanged,
      painters,
      settledFrame,
      drawInto: settledFrame ? null : world.drawnPlaceInto || null,
      drawPlace: settledFrame ? null : world.drawnPlace || null,
      // One object stands for every entity, so equal counts mean nothing has
      // died. Then no object needs a seen marker and the sweep at the end is
      // skipped; `objectsGrew` catches an id swapped for a fresh one.
      sweep: state.meshes.size !== world.entities.length
    }
  }

  /** Run the scan this frame fits, or null when the full pass must answer everything. */
  function scanFrame(pass) {
    if (pass.settledFrame && !pass.marksChanged) return scanQuiet(pass.entities, pass.frame, pass.sweep, pass.ringedId)
    if (!pass.sweep && pass.drawInto) return scanMoving(pass.entities, pass.blend, pass.drawInto, pass.ringedId)
    return null
  }

  /** Drop the objects for entities that left, by the sweep or by a rebuilt set of the ids still present. */
  function dropGoneObjects(entities, frame, sweep) {
    if (sweep) {
      for (const [id, object] of state.meshes) {
        if (object.userData.seen === frame) continue
        state.leaveBatch(id)
        state.discard(object)
        state.meshes.delete(id)
      }
      return
    }
    if (!state.objectsGrew) return
    const living = new Set()
    for (let index = 0; index < entities.length; index++) living.add(entities[index].id)
    for (const [id, object] of state.meshes) {
      if (living.has(id)) continue
      state.leaveBatch(id)
      state.discard(object)
      state.meshes.delete(id)
    }
  }

  /** Write the frame's counts after the batches are rebuilt. */
  function writeFrameStats(entities, keylines) {
    state.stats.entities = entities.length
    state.stats.keylines = keylines
    // A mark writes its own counters, so the core does not learn their names.
    state.writeMarkStats(state.stats)
    // Counted after the rebuild, from the batches that actually drew; see
    // `batchStats` for why a batch with no merged geometry does not count.
    const counted = state.batchStats()
    state.stats.merged = counted.merged
    state.stats.batches = counted.batches
    state.stats.materials = state.materialCount()
  }

  function sync(world, blend = 1) {
    const painters = state.flat()
    const frame = ++frameCounter
    state.beginMarks()

    // A mark's own default may have changed, which has to reach what is already
    // drawn. It says so through the registry, and the frame takes a full pass.
    const marksChanged = state.marksChanged()
    const ringedId = state.markHeldId(state.view)
    const pass = preparePass(world, blend, frame, ringedId, marksChanged, painters)
    state.objectsGrew = false
    // A shorter list means entities went; drop their slots so nothing is held.
    trimSlots(pass.entities.length)
    growDrawnPlaces(pass.entities.length)
    state.growMarks(pass.entities.length)

    // A still frame changes nothing, so the quiet scan answers it in a function
    // of its own and the full pass runs only for what the scan could not answer.
    // A playing frame moves everything, so the moving scan answers what only
    // moved; the full pass is left for the first frame, a list that changed
    // under it, or an entity whose look did.
    const scanned = scanFrame(pass)
    let keylines = scanned === null ? 0 : scanned
    const changed = scanned === null ? pass.entities.length : dirtyIndices.length
    keylines += syncChanged(pass, scanned === null ? null : dirtyIndices, changed)

    dropGoneObjects(pass.entities, pass.frame, pass.sweep)
    state.rebuildBatches()
    state.placeMarks()
    writeFrameStats(pass.entities, keylines)
  }

  state.sync = sync
}
