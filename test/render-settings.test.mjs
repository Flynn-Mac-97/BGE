/**
 * Which value a render setting takes decides how every frame looks, and a wrong
 * layer order or a 2D game picking up 3D tone mapping changes colours with no
 * error. These cases hold the choosing rule.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { ORDER, SETTINGS, check, resolve, valuesOf } from '../plugins/builtin/render/settings.js'

test('a sprite-only level keeps authored colours: no tone mapping, no environment', () => {
  const values = valuesOf(resolve({ hasMeshes: false }))
  assert.equal(values.toneMapping, 'none')
  assert.equal(values.environment, 'none')
})

test('a level with a mesh gets the 3D look', () => {
  const resolved = resolve({ hasMeshes: true })
  assert.equal(resolved.profile, '3d')
  assert.equal(valuesOf(resolved).toneMapping, 'neutral')
  assert.equal(valuesOf(resolved).environment, 'room')
})

test('the level beats the game, and the session beats both', () => {
  const resolved = resolve({
    hasMeshes: true,
    game: { exposure: 1.5, toneMapping: 'neutral' },
    level: { exposure: 0.8 },
    session: { toneMapping: 'aces' }
  })
  assert.deepEqual(resolved.values.exposure, { value: 0.8, from: 'level' })
  assert.deepEqual(resolved.values.toneMapping, { value: 'aces', from: 'session' })
  assert.deepEqual(resolved.values.shadows, { value: 'soft', from: 'default' })
})

test('a profile forced in the game file picks that profile\'s defaults', () => {
  const values = valuesOf(resolve({ hasMeshes: false, game: { profile: '3d' } }))
  assert.equal(values.toneMapping, 'neutral')
})

test('a bad value is reported and the layer below is used', () => {
  const resolved = resolve({ hasMeshes: true, game: { toneMapping: 'filmic', exposure: 99 } })
  assert.equal(valuesOf(resolved).toneMapping, 'neutral')
  assert.equal(valuesOf(resolved).exposure, 0.9)
  assert.equal(resolved.problems.length, 2)
})

test('an unknown setting name is reported, not silently ignored', () => {
  const resolved = resolve({ game: { toneMap: 'agx' } })
  assert.match(resolved.problems[0], /no setting called "toneMap"/)
})

test('an environment may be a .hdr or .exr path', () => {
  assert.equal(check('environment', 'skies/studio.hdr'), null)
  assert.equal(check('environment', 'skies/studio.exr'), null)
  assert.match(check('environment', 'skies/studio.png'), /environment is one of/)
})

test('every setting says what it does and has a default for both profiles', () => {
  for (const key of ORDER) {
    assert.ok(SETTINGS[key].about, `${key} has no about`)
    assert.ok('in2d' in SETTINGS[key] && 'in3d' in SETTINGS[key], `${key} is missing a profile default`)
  }
})
