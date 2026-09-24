/**
 * `geometry-cache`: the solid shapes cached by size, the UVs they are measured
 * in, and the one merge that turns a list of meshes into a single buffer.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three/webgpu'
import { solidGeometry, mergeMeshes } from '../../../engine/render/geometry-cache.js'

/** A mesh over a geometry with exactly `count` vertices and three indices. */
function vertexMesh(count) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2))
  geometry.setAttribute('uv1', new THREE.BufferAttribute(new Float32Array(count * 2), 2))
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array([0, 0, 0]), 1))
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial())
}

test('segments subdivide a quad into more vertices', () => {
  assert.equal(solidGeometry('quad', 1, 1, 0, 4).attributes.position.count, 25)
})

test('a kind with no builder of its own is built as a box', () => {
  assert.equal(solidGeometry('prism', 1, 1, 1).type, 'BoxGeometry')
})

test('a sphere is left unmeasured while a box is measured in metres', () => {
  const sphere = solidGeometry('sphere', 2, 2, 2)
  assert.deepEqual([...sphere.attributes.uv.array], [...sphere.attributes.uv1.array])

  const box = solidGeometry('box', 2, 2, 2)
  assert.equal(Math.max(...box.attributes.uv.array), 2)
  assert.equal(Math.max(...box.attributes.uv1.array), 1)
})

test('a quad is measured once across its single face', () => {
  const quad = solidGeometry('quad', 2, 3, 0)
  assert.deepEqual([...quad.attributes.uv.array], [0, 3, 2, 3, 0, 0, 2, 0])
})

test('one merged source keeps every vertex, normal, UV and index unchanged', () => {
  const mesh = new THREE.Mesh(solidGeometry('box', 2, 2, 2))
  const merged = mergeMeshes([mesh])
  const source = mesh.geometry.attributes
  assert.deepEqual([...merged.attributes.position.array], [...source.position.array])
  assert.deepEqual([...merged.attributes.normal.array], [...source.normal.array])
  assert.deepEqual([...merged.attributes.uv.array], [...source.uv.array])
  assert.deepEqual([...merged.attributes.uv1.array], [...source.uv1.array])
  assert.deepEqual([...merged.index.array], [...mesh.geometry.index.array])
})

test('one merged buffer holds every source vertex, normal and UV', () => {
  const first = new THREE.Mesh(solidGeometry('box', 1, 1, 1))
  const second = new THREE.Mesh(solidGeometry('box', 1, 1, 1))
  second.position.set(5, 0, 0)
  second.updateMatrix()
  const merged = mergeMeshes([first, second])

  assert.equal(merged.attributes.position.count, 48)
  assert.equal(merged.attributes.position.getX(0), first.geometry.attributes.position.getX(0))
  assert.equal(merged.attributes.position.getX(24), 5.5)
  assert.equal(merged.attributes.normal.getX(24), first.geometry.attributes.normal.getX(0))
  assert.equal(merged.attributes.normal.getY(24), first.geometry.attributes.normal.getY(0))
  assert.equal(merged.attributes.normal.getZ(24), first.geometry.attributes.normal.getZ(0))
  assert.equal(merged.attributes.uv.getX(24), first.geometry.attributes.uv.getX(0))
  assert.equal(merged.attributes.uv.getY(24), first.geometry.attributes.uv.getY(0))
  assert.equal(merged.attributes.uv1.getX(24), first.geometry.attributes.uv1.getX(0))
  assert.equal(merged.attributes.uv1.getY(24), first.geometry.attributes.uv1.getY(0))
})

test("a merged buffer keeps each source's own index, offset by the vertices before it", () => {
  const first = new THREE.Mesh(solidGeometry('box', 1, 1, 1))
  const second = new THREE.Mesh(solidGeometry('box', 1, 1, 1))
  const merged = mergeMeshes([first, second])

  assert.equal(merged.index.count, 72)
  assert.equal(merged.index.getX(0), first.geometry.index.getX(0))
  assert.equal(merged.index.getX(36), 24 + second.geometry.index.getX(0))
})

test("a merged buffer's second UV set is the source's face UVs, not the metres", () => {
  const mesh = new THREE.Mesh(solidGeometry('box', 2, 2, 2))
  const merged = mergeMeshes([mesh])
  assert.equal(Math.max(...merged.attributes.uv.array), 2)
  assert.equal(Math.max(...merged.attributes.uv1.array), 1)
})

test('a merged buffer with at most 65535 vertices uses a 16-bit index', () => {
  assert.equal(mergeMeshes([vertexMesh(65535)]).index.array.constructor, Uint16Array)
})

test('a merged buffer with 65536 vertices uses a 32-bit index', () => {
  assert.equal(mergeMeshes([vertexMesh(65536)]).index.array.constructor, Uint32Array)
})
