/**
 * A keyline hull leaves out skinned meshes.
 *
 * The hull is baked once from rest positions. A skinned mesh is drawn where its
 * bones put it, so outlining its rest shape drew a T-pose beside the posed body.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three/webgpu'
import { hullGeometry } from '../plugins/builtin/readability/hull.js'

function skinnedBox() {
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  const count = geometry.attributes.position.count
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(count * 4).fill(0), 4))
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Array(count * 4).fill(0).map((_, index) => (index % 4 === 0 ? 1 : 0)), 4))
  const bone = new THREE.Bone()
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial())
  mesh.add(bone)
  mesh.bind(new THREE.Skeleton([bone]))
  return mesh
}

test('a model of only skinned meshes has no hull', () => {
  const model = new THREE.Group()
  model.add(skinnedBox())
  assert.equal(hullGeometry(model), null)
})

test('a plain mesh beside a skinned one is still outlined', () => {
  const model = new THREE.Group()
  model.add(skinnedBox())
  model.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()))
  const hull = hullGeometry(model)
  assert.equal(hull.attributes.position.count, 24)
})
