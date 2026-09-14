/**
 * Which implementation of a shader gets built.
 *
 * This is the one thing here that fails silently: a shader with a GLSL and a
 * TSL implementation draws either way, so choosing the wrong one looks like a
 * surface somebody restyled rather than a bug. Every case below is a choice
 * nobody could see in a frame.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { makeShaderLanguages } from '../plugins/builtin/shader-languages/registry.js'

/** A registry with both languages, and a backend the test moves. */
function registryOn(backend) {
  const published = []
  const swaps = []
  const registry = makeShaderLanguages({
    backend: () => backend.now,
    publish: (name, build, details) => published.push({ name, build, language: details.language }),
    swapped: moved => swaps.push(moved)
  })
  registry.register('tsl', { supported: () => true })
  registry.register('glsl', {
    supported: live => (live && !live.webgpu) ? true : 'the WebGPU backend is drawing'
  })
  return { registry, published, swaps }
}

test('a shader written in one language is built from it whatever is preferred', () => {
  const { registry } = registryOn({ now: { webgpu: false } })
  registry.implement('waves', 'tsl', () => 'tsl waves')
  registry.prefer('glsl')
  assert.equal(registry.chosen('waves').language, 'tsl')
  assert.equal(registry.build('waves'), 'tsl waves')
})

test('the preferred language wins where a shader is written in both', () => {
  const { registry } = registryOn({ now: { webgpu: false } })
  registry.implement('aura', 'tsl', () => 'tsl aura')
  registry.implement('aura', 'glsl', () => 'glsl aura')
  assert.equal(registry.chosen('aura').language, 'tsl')
  registry.prefer('glsl')
  assert.equal(registry.build('aura'), 'glsl aura')
})

test('a language the backend cannot build is never chosen', () => {
  const { registry } = registryOn({ now: { webgpu: true } })
  registry.implement('aura', 'tsl', () => 'tsl aura')
  registry.implement('aura', 'glsl', () => 'glsl aura')
  registry.prefer('glsl')
  assert.equal(registry.chosen('aura').language, 'tsl')
  assert.match(registry.supports('glsl'), /WebGPU/)
})

test('the backend is asked every time, not once', () => {
  const backend = { now: { webgpu: true } }
  const { registry } = registryOn(backend)
  registry.implement('aura', 'glsl', () => 'glsl aura')
  registry.prefer('glsl')
  assert.equal(registry.chosen('aura'), null)
  backend.now = { webgpu: false }
  assert.equal(registry.chosen('aura').language, 'glsl')
})

test('a material is published under its own name, a program is not', () => {
  const { registry, published } = registryOn({ now: { webgpu: false } })
  registry.describe('aura', { kind: 'material' })
  registry.implement('aura', 'tsl', () => 'tsl aura')
  registry.describe('particle-colour', { kind: 'program' })
  registry.implement('particle-colour', 'tsl', () => 'tsl particle')
  assert.deepEqual(published.filter(one => one.name === 'particle-colour'), [])
  const last = published.filter(one => one.name === 'aura').pop()
  assert.equal(last.language, 'tsl')
  assert.equal(last.build(), 'tsl aura')
})

test('a swap says what moved, so a cached material can be dropped', () => {
  const { registry, swaps } = registryOn({ now: { webgpu: false } })
  registry.implement('aura', 'tsl', () => 'tsl aura')
  registry.implement('aura', 'glsl', () => 'glsl aura')
  registry.implement('waves', 'tsl', () => 'tsl waves')
  const result = registry.prefer('glsl')
  assert.deepEqual(result.moved, [{ shader: 'aura', was: 'tsl', now: 'glsl' }])
  assert.deepEqual(swaps, [result.moved])
})

test('preferring a language nobody registered changes nothing and says so', () => {
  const { registry } = registryOn({ now: { webgpu: false } })
  registry.implement('aura', 'tsl', () => 'tsl aura')
  const result = registry.prefer('wgsl')
  assert.equal(result.preferred, 'tsl')
  assert.deepEqual(result.moved, [])
  assert.match(registry.problems.join(' '), /no language named "wgsl"/)
})

test('describing a shader needs no language, and says nothing can build it', () => {
  const { registry } = registryOn({ now: null })
  registry.describe('hologram', { kind: 'material', parameters: { lines: 26 } })
  const listed = registry.list().find(one => one.name === 'hologram')
  assert.equal(listed.building, null)
  assert.deepEqual(listed.written, [])
  assert.equal(listed.parameters.lines, 26)
  assert.equal(registry.build('hologram'), null)
})

test('a build that throws is reported and returns null, so the frame goes on', () => {
  const { registry } = registryOn({ now: { webgpu: false } })
  registry.implement('aura', 'tsl', () => { throw new Error('a plain number where a node was wanted') })
  assert.equal(registry.build('aura'), null)
  assert.match(registry.problems.join(' '), /a plain number where a node was wanted/)
})

test('an implementation that is not a function is refused, not stored', () => {
  const { registry } = registryOn({ now: { webgpu: false } })
  registry.implement('aura', 'tsl', () => 'tsl aura')
  registry.implement('aura', 'glsl', 'vec4 aura() {}')
  registry.prefer('glsl')
  assert.equal(registry.chosen('aura').language, 'tsl')
  assert.match(registry.problems.join(' '), /is not a function/)
})
