/**
 * `renderer.materials` — what a surface is made of, and the door a plugin adds
 * its own through.
 *
 * The two built-ins register through the same door, so the door is a hook and
 * not a core-only shortcut. Registering a name that already exists rebuilds
 * every material, because a plugin that loads after a level still has to take
 * effect. A name nothing registered falls back to a built-in rather than
 * drawing nothing.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three/webgpu'
import { makeRenderer } from '../../engine/render.js'

const VIEW = { mode: 'ortho', x: 0, y: 0, z: 0, zoom: 1 }
const VIEWPORT = { width: 320, height: 180 }

const meshEntity = (id, material) => ({
  id, type: 'wall', x: 0, y: 0, z: 0, mesh: { box: [1, 1, 1], material }
})

const objectMaterial = (frame, id, material) => {
  frame.sync({ entities: [meshEntity(id, material)] })
  return frame.objectFor({ id }).material
}

test('the two built-in surfaces are in the registry, because the core uses the same door', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  assert.equal(frame.materials.has('lambert'), true)
  assert.equal(frame.materials.has('basic'), true)
  assert.ok(frame.materials.names.includes('lambert'))
})

test('a registered material is used for an entity that names it, and the builder sees the declaration', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  let seen = null
  frame.materials.register('probe', ({ mesh, tint, uv }) => {
    seen = { mesh, tint, uv }
    return new THREE.MeshBasicMaterial({ color: '#ff3300' })
  })

  const material = objectMaterial(frame, 'painted', 'probe')
  assert.equal(material.type, 'MeshBasicMaterial')
  assert.equal(material.color.getHexString(), 'ff3300')
  assert.equal(seen.mesh.material, 'probe', 'the builder reads the whole declaration')
  assert.ok(seen.tint instanceof THREE.Color, 'tint is always a colour')
  assert.equal(typeof seen.uv.face, 'function')
  assert.equal(typeof seen.uv.metres, 'function')
})

test('re-registering a name rebuilds every material built from it', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  let builds = 0
  frame.materials.register('probe', () => {
    builds++
    return new THREE.MeshBasicMaterial({ color: '#ff0000' })
  })

  const first = objectMaterial(frame, 'painted', 'probe')
  assert.equal(builds, 1)

  frame.materials.register('probe', () => {
    builds++
    return new THREE.MeshBasicMaterial({ color: '#00ff00' })
  })
  const second = objectMaterial(frame, 'painted', 'probe')

  assert.equal(builds, 2, 'the second registration builds again')
  assert.notEqual(first, second, 'the entity carries a rebuilt material')
  assert.equal(first.color.getHexString(), 'ff0000')
  assert.equal(second.color.getHexString(), '00ff00')
})

test('an unknown name falls back to a built-in surface', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const material = objectMaterial(frame, 'mystery', 'no-such-surface')
  assert.equal(material.type, 'MeshLambertMaterial', 'the fallback is lambert')
})

test('registering a name again does not add a second entry', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  frame.materials.register('probe', () => new THREE.MeshBasicMaterial())
  frame.materials.register('probe', () => new THREE.MeshBasicMaterial())
  const named = frame.materials.names.filter(name => name === 'probe')
  assert.equal(named.length, 1)
})
