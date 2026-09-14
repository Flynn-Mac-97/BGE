/**
 * Staleness is decided in one place and read by two halves — the panel in the
 * browser and the importer in node. A change that makes them disagree shows up
 * as a model that is never rebuilt, or one rebuilt on every draw, and neither
 * says which side is wrong. These cases pin the rule itself.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_SETTINGS, importState, inSeconds, modelFile, readSettings, settingsFile, writeSettings
} from '../plugins/builtin/blender-assets/state.js'

const source = { modified: 1757721600, size: 100 }
const built = { source: 'kitten.blend', ...source, settings: { ...DEFAULT_SETTINGS } }
const fresh = { built, settings: { ...DEFAULT_SETTINGS }, source, modelExists: true }

test('names are taken from the .blend', () => {
  assert.equal(modelFile('assets/models/kitten.blend'), 'assets/models/kitten.glb')
  assert.equal(settingsFile('assets/models/kitten.blend'), 'assets/models/kitten.import.json')
})

test('a model built from this .blend, with these settings, is fresh', () => {
  assert.equal(importState(fresh).state, 'fresh')
})

test('never imported, rather than stale', () => {
  assert.equal(importState({ ...fresh, built: null }).state, 'never')
})

test('an edited .blend is stale', () => {
  assert.equal(importState({ ...fresh, source: { ...source, modified: source.modified + 1 } }).state, 'stale')
  assert.equal(importState({ ...fresh, source: { ...source, size: 101 } }).state, 'stale')
})

test('changed settings make the model stale', () => {
  assert.equal(importState({ ...fresh, settings: { ...DEFAULT_SETTINGS, scale: 0.01 } }).state, 'stale')
})

test('a deleted model is stale even when the .blend has not changed', () => {
  assert.equal(importState({ ...fresh, modelExists: false }).state, 'stale')
})

test('an unreadable .blend is stale, not fresh', () => {
  assert.equal(importState({ ...fresh, source: null }).state, 'stale')
})

/**
 * The panel reads seconds from a `Last-Modified` header and node reads
 * milliseconds from a stat. Both are stored as seconds, or every file reads as
 * stale in the browser and fresh in node.
 */
test('times are stored in whole seconds', () => {
  assert.equal(inSeconds(1757721600999), 1757721600)
})

test('settings survive a write and a read, and defaults fill the gaps', () => {
  const text = writeSettings({ settings: { ...DEFAULT_SETTINGS, scale: 0.01 }, built })
  const read = readSettings(text)
  assert.equal(read.settings.scale, 0.01)
  assert.equal(read.settings.applyModifiers, true)
  assert.deepEqual(read.built, built)
})

test('a missing or broken settings file means defaults and nothing built', () => {
  for (const text of ['', 'not json', '{}']) {
    const read = readSettings(text)
    assert.deepEqual(read.settings, DEFAULT_SETTINGS)
    assert.equal(read.built, null)
  }
})

test('an unknown key in the settings file is ignored, not carried through', () => {
  const read = readSettings('{"scale":2,"nonsense":true}')
  assert.equal(read.settings.scale, 2)
  assert.equal(read.settings.nonsense, undefined)
})

/**
 * Baking changes what the model looks like, so it has to make the model stale
 * the same way scale does. The rule is written once over every setting key;
 * this holds a new key to it.
 */
test('a changed bake setting makes the model stale', () => {
  for (const changed of [{ bake: true }, { bakeSize: 512 }, { bakeSamples: 64 }]) {
    assert.equal(importState({ ...fresh, settings: { ...DEFAULT_SETTINGS, ...changed } }).state, 'stale')
  }
})

test('bake is off by default, because it costs a render per mesh', () => {
  assert.equal(DEFAULT_SETTINGS.bake, false)
})
