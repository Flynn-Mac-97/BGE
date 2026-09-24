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
import { makeRenderer } from '../../../engine/render.js'
import { clearReported } from '../../../engine/render/report.js'
import { entityTint } from '../../../engine/render/entity-look.js'
import { withImageDocument } from './image-document.mjs'
import { captureConsoleError } from './report-capture.mjs'

const VIEW = { mode: 'ortho', x: 0, y: 0, z: 0, zoom: 1 }
const VIEWPORT = { width: 320, height: 180 }

const meshEntity = (id, material) => ({
  id,
  type: 'wall',
  x: 0,
  y: 0,
  z: 0,
  mesh: { box: [1, 1, 1], material }
})

const objectMaterial = (frame, id, material) => {
  frame.sync({ entities: [meshEntity(id, material)] })
  return frame.objectFor({ id }).material
}

const materialOfTextured = (frame, id, material) => {
  const mesh = { box: [1, 1, 1], material, texture: 'wall.png' }
  frame.sync({ entities: [{ id, type: 'wall', x: 0, y: 0, z: 0, mesh }] })
  return frame.objectFor({ id }).material
}

const materialOfSprite = (frame, id, sprite = { width: 1, height: 1 }) => {
  frame.sync({ entities: [{ id, type: 'wall', x: 0, y: 0, z: 0, sprite }] })
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

test('a lambert surface keeps the texture its declaration names', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  withImageDocument(() => {
    assert.ok(materialOfTextured(frame, 'textured-lambert', 'lambert').map)
  })
})

test('a basic surface keeps the texture its declaration names', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  withImageDocument(() => {
    assert.ok(materialOfTextured(frame, 'textured-basic', 'basic').map)
  })
})

test('a lambert surface tests and writes depth', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const material = objectMaterial(frame, 'depth-lambert', 'lambert')
  assert.equal(material.depthTest, true)
  assert.equal(material.depthWrite, true)
})

test('a basic surface tests and writes depth', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const material = objectMaterial(frame, 'depth-basic', 'basic')
  assert.equal(material.depthTest, true)
  assert.equal(material.depthWrite, true)
})

test('an unknown surface is named as it falls back to lambert', async () => {
  clearReported()
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const said = captureConsoleError(() => {
    objectMaterial(frame, 'mystery-report', 'nothing-registered')
  })
  assert.ok(said.some(line => line.includes('no material named "nothing-registered"')))
})

test('a declared lightmap reaches a lambert material on the second UV channel', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  withImageDocument(() => {
    const mesh = { box: [1, 1, 1], lightmap: 'bake.png' }
    frame.sync({ entities: [{ id: 'baked', type: 'wall', x: 0, y: 0, z: 0, mesh }] })
    const material = frame.objectFor({ id: 'baked' }).material
    assert.ok(material.lightMap)
    assert.equal(material.lightMap.channel, 1)
  })
})

test('a sprite surface is transparent', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  assert.equal(materialOfSprite(frame, 'transparent-sprite').transparent, true)
})

test('a sprite with no picture falls back to a tint and no map', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  withImageDocument(() => {
    const material = materialOfSprite(frame, 'blank-sprite')
    assert.equal(material.map, null)
    assert.equal(material.color.getHexString(), entityTint('wall').getHexString())
  })
})

test('a sprite falls back to its tint when the picture fails', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  withImageDocument(images => {
    const sprite = { image: 'broken-sprite.png', width: 1, height: 1 }
    frame.sync({ entities: [{ id: 'broken-sprite', type: 'wall', x: 0, y: 0, z: 0, sprite }] })
    const material = frame.objectFor({ id: 'broken-sprite' }).material
    assert.ok(material.map, 'the picture is the map while it loads')
    const version = material.version
    images.failAll()
    assert.equal(material.map, null)
    assert.equal(material.color.getHexString(), entityTint('wall').getHexString())
    assert.ok(material.version > version, 'the fallback is marked for upload')
  })
})

test('two tiled sprites of one file do not share a texture', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  withImageDocument(() => {
    const sprite = { image: 'tiled-sprite.png', width: 1, height: 1, tile: 2 }
    frame.sync({
      entities: [
        { id: 'tile-a', type: 'wall', x: 0, y: 0, z: 0, sprite },
        { id: 'tile-b', type: 'wall', x: 1, y: 0, z: 0, sprite }
      ]
    })
    assert.notEqual(frame.objectFor({ id: 'tile-a' }).material.map, frame.objectFor({ id: 'tile-b' }).material.map)
  })
})

test('a declared shape chooses its own geometry', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  frame.sync({
    entities: [
      { id: 'quad-shape', type: 'wall', x: 0, y: 0, z: 0, mesh: { quad: [1, 1] } },
      { id: 'sphere-shape', type: 'ball', x: 0, y: 0, z: 0, mesh: { sphere: 1 } }
    ]
  })
  assert.equal(frame.objectFor({ id: 'quad-shape' }).geometry.type, 'PlaneGeometry')
  assert.equal(frame.objectFor({ id: 'sphere-shape' }).geometry.type, 'SphereGeometry')
})

test('register refuses an empty name', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  frame.materials.register('', () => new THREE.MeshBasicMaterial())
  assert.equal(frame.materials.has(''), false)
})

test('register refuses a build that is not a function', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  frame.materials.register('broken-build', 42)
  assert.equal(frame.materials.has('broken-build'), false)
})
