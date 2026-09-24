/**
 * `texture-cache`: one texture per file and reading, the wait a copy does
 * before its image arrives, and the cache a forgotten file leaves.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three/webgpu'
import { withImageDocument } from './image-document.mjs'
import {
  cachedTexture,
  tiledTexture,
  privateTexture,
  textureStatus,
  clearTextures,
  forgetTextures
} from '../../../engine/render/texture-cache.js'

test('a texture that was never asked for reports the unknown status', () => {
  assert.equal(textureStatus('never-asked.png', 'world'), 'unknown')
})

test('a failure callback given on a later request runs when the file fails', () => {
  withImageDocument(images => {
    clearTextures()
    let first = 0
    let later = 0
    cachedTexture('failure-later.png', 'world', () => first++)
    cachedTexture('failure-later.png', 'world', () => later++)
    images.failAll()
    assert.equal(first, 1)
    assert.equal(later, 1, 'the callback registered while the file was loading is kept')
  })
})

test('a tiled copy made while the file loads is marked for upload when it arrives', () => {
  withImageDocument(images => {
    clearTextures()
    cachedTexture('tiled-later.png', 'world')
    const copy = tiledTexture('tiled-later.png', 'world', 2, 2)
    assert.equal(copy.version, 0, 'nothing to upload before the image')
    images.loadAll()
    assert.ok(copy.version > 0, 'the copy uploads once the image is here')
  })
})

test('a private copy made after the file is ready is marked for upload at once', () => {
  withImageDocument(images => {
    clearTextures()
    cachedTexture('private-after.png', 'world')
    images.loadAll()
    const copy = privateTexture('private-after.png', 'world')
    assert.ok(copy.version > 0)
  })
})

test('a sprite reading is nearest-neighbour with no mipmaps', () => {
  withImageDocument(() => {
    clearTextures()
    const texture = cachedTexture('sprite-read.png', 'sprite')
    assert.equal(texture.magFilter, THREE.NearestFilter)
    assert.equal(texture.minFilter, THREE.NearestFilter)
    assert.equal(texture.generateMipmaps, false)
  })
})

test('a world reading is linear with mipmaps and repeats', () => {
  withImageDocument(() => {
    clearTextures()
    const texture = cachedTexture('world-read.png', 'world')
    assert.equal(texture.magFilter, THREE.LinearFilter)
    assert.equal(texture.minFilter, THREE.LinearMipmapLinearFilter)
    assert.equal(texture.generateMipmaps, true)
    assert.equal(texture.wrapS, THREE.RepeatWrapping)
  })
})

test('a lightmap reading clamps instead of repeating', () => {
  withImageDocument(() => {
    clearTextures()
    const texture = cachedTexture('lightmap-read.png', 'lightmap')
    assert.equal(texture.wrapS, THREE.ClampToEdgeWrapping)
    assert.equal(texture.wrapT, THREE.ClampToEdgeWrapping)
  })
})

test('forgetting a file drops its cached texture', () => {
  withImageDocument(() => {
    clearTextures()
    const texture = cachedTexture('forgotten.png', 'world')
    forgetTextures('forgotten.png')
    assert.notEqual(cachedTexture('forgotten.png', 'world'), texture)
  })
})

test('forgetting the assets-prefixed name drops the same texture', () => {
  withImageDocument(() => {
    clearTextures()
    const texture = cachedTexture('prefixed.png', 'world')
    forgetTextures('assets/prefixed.png')
    assert.notEqual(cachedTexture('prefixed.png', 'world'), texture)
  })
})

test('forgetting one file leaves another cached', () => {
  withImageDocument(() => {
    clearTextures()
    const texture = cachedTexture('kept.png', 'world')
    forgetTextures('other.png')
    assert.equal(cachedTexture('kept.png', 'world'), texture)
  })
})
