/**
 * Kernel: what a frame already knows about one entity, kept beside it.
 *
 * The record answers the plan, the turn and the last written transform without
 * measuring them again, and carries the settled, idle and steady marks the
 * scans read. It is keyed by the entity object rather than its id, because
 * hashing fifty thousand id strings a frame is the cost this exists to remove.
 */
import { entityPlan, turnRadians } from '../frame-plan.js'

export function makeEntityRecords(state) {
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
      outline: false,
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
      // A mark that hangs geometry off this entity keeps its own fields here, beside
      // the object it stands for. The core adds none of its own, so the record does
      // not grow a property for every feature the renderer gains.
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

  /** Whether the record's stored position and rotation still match the object's. */
  function sameOrientation(record, object) {
    return record.placedX === object.position.x
      && record.placedY === object.position.y
      && record.placedZ === object.position.z
      && record.placedRotX === object.rotation.x
      && record.placedRotY === object.rotation.y
      && record.placedRotZ === object.rotation.z
  }

  /** Whether the record's stored scale still matches the object's. */
  function sameScale(record, object) {
    return record.placedScaleX === object.scale.x
      && record.placedScaleY === object.scale.y
      && record.placedScaleZ === object.scale.z
  }

  /** Whether the record last wrote exactly the transform the object carries now. */
  function samePlace(record, object) {
    return record.placedObject === object && sameOrientation(record, object) && sameScale(record, object)
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
    if (samePlace(record, object)) return
    record.placedObject = object
    record.placedX = object.position.x
    record.placedY = object.position.y
    record.placedZ = object.position.z
    record.placedRotX = object.rotation.x
    record.placedRotY = object.rotation.y
    record.placedRotZ = object.rotation.z
    record.placedScaleX = object.scale.x
    record.placedScaleY = object.scale.y
    record.placedScaleZ = object.scale.z
    object.updateMatrix()
    state.shadowDirty = true
  }

  return { recordAt, planFor, turnFor, placeMatrix, drawnPlaceScratch }
}
