/**
 * `model-cache`: one fetch per file, a clone per entity, and the answer a
 * caller gets for a file that is ready, failed or still loading.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three/webgpu'
import { cloneModel, cachedModel, modelCache } from '../../../engine/render/model-cache.js'

/** A one-bone skinned mesh, enough for a rebind to be visible. */
function skinnedMesh() {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3))
  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array([0, 0, 0, 0]), 4))
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array([1, 0, 0, 0]), 4))
  const bone = new THREE.Bone()
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial())
  mesh.add(bone)
  mesh.bind(new THREE.Skeleton([bone]))
  return mesh
}

/** Ask for one bogus model so the skeleton helper is imported, then let the import settle. */
async function loadSkeletonHelper() {
  cachedModel(
    'skeleton-helper.glb',
    () => {},
    () => {}
  )
  await import('three/examples/jsm/loaders/GLTFLoader.js')
  await import('three/examples/jsm/utils/SkeletonUtils.js')
  await new Promise(resolve => setImmediate(resolve))
  modelCache.delete('skeleton-helper.glb')
}

test('a ready model answers the caller with the scene it holds', () => {
  const scene = new THREE.Group()
  modelCache.set('ready-model.glb', { status: 'ready', scene, waiting: [] })
  const handed = []
  cachedModel(
    'ready-model.glb',
    loaded => handed.push(loaded),
    () => {}
  )
  modelCache.delete('ready-model.glb')
  assert.deepEqual(handed, [scene])
})

test('a failed model answers the caller with failure', () => {
  modelCache.set('failed-model.glb', { status: 'failed', scene: null, waiting: [] })
  let ready = 0
  let failed = 0
  cachedModel(
    'failed-model.glb',
    () => ready++,
    () => failed++
  )
  modelCache.delete('failed-model.glb')
  assert.equal(failed, 1)
  assert.equal(ready, 0)
})

test('a model with no skeleton is cloned as a plain scene graph', () => {
  const original = new THREE.Object3D()
  original.add(new THREE.Object3D())
  const copy = cloneModel(original)
  assert.notEqual(copy, original)
  assert.equal(copy.children.length, 1)
})

test('a skinned model gets its own skeleton rather than sharing the original', async () => {
  await loadSkeletonHelper()
  const original = skinnedMesh()
  const copy = cloneModel(original)
  assert.notEqual(copy.skeleton, original.skeleton)
})
