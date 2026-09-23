/**
 * Kernel: static entities merged by material and by grid cell, so several
 * hundred boxes draw in a few dozen calls.
 */
import * as THREE from 'three/webgpu'
import { mergeMeshes } from './geometry-cache.js'
import { DRAWN, MERGED } from './scene-layers.js'

export function makeBatching(state) {
  /**
   * Several hundred boxes, drawn in a few dozen calls.
   *
   * A Counter-Strike map is mostly walls that never move, and every one of them
   * is its own size, so instancing buys almost nothing — on de_dust2 only 41 of
   * 281 entities share a size with seven others. Merging by MATERIAL is the
   * right axis: 233 brushes are drawn from about eight textures.
   *
   * Two rules keep it honest. Batches are cut by a grid cell as well as by
   * material, because one merged geometry spanning the whole map has one
   * bounding sphere and can never be frustum-culled — the merge would buy draw
   * calls by selling culling. And an entity only joins once it has held still
   * for SETTLE frames, so anything a person is dragging, or a door swinging, is
   * simply never in a batch. A merged entity keeps its own mesh for picking, on
   * a layer the camera does not draw.
   */
  const MERGE_CELL = 32      // metres; big enough to group, small enough to cull
  const MERGE_MINIMUM = 4    // below this, merging costs more than it saves
  const SETTLE = 45          // frames of stillness before a thing counts as static

  const batches = new Map()  // batch key -> { material, members, object, dirty }

  /**
   * Take an entity out of its batch and put its own mesh back on the drawn layer.
   *
   * The batch key is kept on the object rather than in the frame record, so the
   * dead-object sweep can leave a batch without having an entity to hand. The
   * record's copy is cleared when the caller has one, which lets the moving path
   * answer "is this in a batch" without reaching into the object.
   */
  function leaveBatch(id, record) {
    const object = state.meshes.get(id)
    const key = object?.userData.batch
    if (record) record.batchKey = null
    if (!key) return
    const batch = batches.get(key)
    if (batch) { batch.members.delete(id); batch.dirty = true }
    object.userData.batch = null
    drawOn(object, DRAWN)
  }

  /** Put an object and its keyline on one layer. A layer is not inherited. */
  function drawOn(object, layer) {
    object.layers.set(layer)
    object.userData.keylineMesh?.layers.set(layer)
  }

  /** Add an entity to the batch for its key, creating the batch if needed. */
  function joinBatch(entity, object, key, materialKey, record) {
    let batch = batches.get(key)
    if (!batch) {
      batch = { material: null, members: new Set(), object: null, dirty: true }
      batches.set(key, batch)
    }
    // Re-read the material on every join rather than only on the first. A hot
    // reload throws away every shared material, and a batch still holding the
    // one it was created with would go on drawing the texture that was edited.
    batch.material = state.meshMaterial(entity, materialKey)
    batch.members.add(entity.id)
    batch.dirty = true
    object.userData.batch = key
    record.batchKey = key
  }

  /** Rebuild every dirty batch's merged mesh, or drop one below the merge minimum. */
  function rebuildBatches() {
    for (const [key, batch] of batches) {
      if (!batch.dirty) continue
      batch.dirty = false

      if (batch.object) {
        state.scene.remove(batch.object)
        // The merged geometry belongs to this batch alone, unlike the cached
        // box geometry it was built from.
        batch.object.geometry.dispose()
        state.release(batch.object)
        batch.object = null
      }

      const members = [...batch.members].map(id => state.meshes.get(id)).filter(Boolean)
      if (members.length < MERGE_MINIMUM) {
        for (const member of members) drawOn(member, DRAWN)
        if (!batch.members.size) batches.delete(key)
        continue
      }

      batch.object = new THREE.Mesh(mergeMeshes(members), batch.material)
      batch.object.matrixAutoUpdate = false
      batch.object.userData.batch = key
      // The merged copy is what is drawn, so it is what has to cast and receive.
      // Casting is part of the batch key, so every member agrees and the first
      // one speaks for all.
      batch.object.castShadow = members[0].castShadow
      batch.object.receiveShadow = members[0].receiveShadow
      state.scene.add(batch.object)
      for (const member of members) drawOn(member, MERGED)
    }
  }

  /** Whether this entity is standing still enough, and plainly enough, to merge. */
  function canMergeNow(entity, described, declared, opacity, isModel) {
    // A model is a scene graph rather than one box, so there is nothing here to
    // merge; a dimmed entity has its own material and would take the whole batch
    // with it; a hidden one has to be able to disappear on its own. An entity a
    // mark owns keeps its own mesh — a keyline hangs off it — and a merged entity
    // draws on a layer the camera ignores, which would take the mark with it.
    return !isModel && opacity >= 1 && !entity.hidden && !state.markBlocksMerge(declared)
  }

  /**
   * Whether the entity moved since the last pass.
   *
   * The stillness signature, compared as numbers instead of assembled into a
   * string and compared back. The look is one shared string while the
   * declaration holds, so that compare finds the same instance.
   */
  function hasMoved(entity, described, turn, record) {
    return record.sigX !== entity.x || record.sigY !== entity.y
      || record.sigZ !== (entity.z || 0)
      || record.sigTurnX !== turn.x || record.sigTurnY !== turn.y || record.sigTurnZ !== turn.z
      || record.sigScale !== (entity.scale ?? 1)
      || record.sigLook !== described.look
  }

  /** Write down the place and look this pass drew, so the next pass compares against it. */
  function rememberSignature(record, entity, described, turn) {
    record.sigX = entity.x
    record.sigY = entity.y
    record.sigZ = entity.z || 0
    record.sigTurnX = turn.x
    record.sigTurnY = turn.y
    record.sigTurnZ = turn.z
    record.sigScale = entity.scale ?? 1
    record.sigLook = described.look
  }

  /**
   * Handle a moved entity: leave its batch, remember the new place, and restart
   * its stillness count.
   *
   * The first signature is where it appeared, not a move. Every one after it is,
   * and the answer sticks: an enemy that stops to bite must not drop its keyline
   * and its shadow for as long as it stands still.
   */
  function recordMove(entity, described, turn, canMerge, record) {
    // Leave the batch this frame, before anything is drawn, or the merged copy
    // stays behind at the old place as a ghost.
    if (record.batchKey !== null) leaveBatch(entity.id, record)
    if (record.haveSignature) record.moved = true
    record.haveSignature = true
    rememberSignature(record, entity, described, turn)
    record.frames = 0
    record.settled = !canMerge
  }

  /** The batch key: material, whether it casts, and the grid cell it stands in. */
  function batchKeyFor(entity, object, described) {
    const cellX = Math.floor(entity.x / MERGE_CELL)
    const cellZ = Math.floor((entity.z || 0) / MERGE_CELL)
    // Casting is part of the key, not just material and cell. One merged mesh
    // has one castShadow flag, so a batch holding both a caster and a
    // non-caster has to pick one and is wrong for half its members.
    const casts = object.castShadow === false ? 'flat' : 'casts'
    return `${described.material}|${casts}|${cellX},${cellZ}`
  }

  /** Join or leave the batch this entity now belongs to. */
  function applyMergeWish(entity, object, described, record, wanted) {
    if (wanted && record.batchKey === null) {
      joinBatch(entity, object, batchKeyFor(entity, object, described), described.material, record)
      return
    }
    if (!wanted && record.batchKey !== null) leaveBatch(entity.id, record)
  }

  function considerForMerging(entity, object, described, declared, opacity, isModel, turn, record) {
    const canMerge = canMergeNow(entity, described, declared, opacity, isModel)
    if (hasMoved(entity, described, turn, record)) {
      recordMove(entity, described, turn, canMerge, record)
      return
    }
    if (record.frames < SETTLE) record.frames++
    const wanted = canMerge && record.frames >= SETTLE
    applyMergeWish(entity, object, described, record, wanted)
    if (record.frames >= SETTLE || !canMerge) record.settled = true
  }

  /**
   * How much of the frame the merge actually caught, for `stats`.
   *
   * Counted only from batches that drew: a group that never reached
   * `MERGE_MINIMUM` has members but no merged geometry, and reporting those as
   * merged would flatter the number this exists to be honest about.
   */
  function batchStats() {
    let drawn = 0
    let merged = 0
    for (const batch of batches.values()) {
      if (!batch.object) continue
      drawn++
      merged += batch.members.size
    }
    return { batches: drawn, merged }
  }

  state.leaveBatch = leaveBatch
  state.drawOn = drawOn
  state.joinBatch = joinBatch
  state.rebuildBatches = rebuildBatches
  state.considerForMerging = considerForMerging
  state.batchStats = batchStats
}
