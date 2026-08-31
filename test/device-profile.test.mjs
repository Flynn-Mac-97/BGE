/**
 * The declared device profile, checked headless.
 *
 * A game says once which screen it is drawn for. The viewport must come from
 * that declaration, and a game that declares nothing must still get a viewport.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { startWorldInNode } from '../engine/start-world-node.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('a declared device sets the viewport and reaches context', async () => {
  const { context } = await startWorldInNode({ root: ROOT, project: 'kitten-survivors' })
  assert.deepEqual(context.device, {
    width: 540, height: 960, pixelRatio: 2, orientation: 'portrait'
  })
  assert.equal(context.viewport.width, 540)
  assert.equal(context.viewport.height, 960)
})

test('a game that declares no device still gets a viewport', async () => {
  const { context } = await startWorldInNode({ root: ROOT, project: 'project' })
  assert.equal(context.device.width, 1280)
  assert.equal(context.device.height, 720)
  assert.equal(context.device.orientation, 'landscape')
  assert.equal(context.viewport.width, 1280)
  assert.equal(context.viewport.height, 720)
})

test('a measured screen beats the declaration', async () => {
  const { context } = await startWorldInNode({
    root: ROOT, project: 'kitten-survivors', viewport: { width: 800, height: 600 }
  })
  assert.equal(context.viewport.width, 800)
  assert.equal(context.device.width, 540)
})

test('a generated sketch name carries no client headless and never repeats', async () => {
  const { context, engine } = await startWorldInNode({ root: ROOT, project: 'kitten-survivors' })
  const first = await engine.run('see.sketch', {})
  const second = await engine.run('see.sketch', {})
  const level = context.editor.levelName
  assert.match(first.files[0], new RegExp(`agent-runs/see/${level}-sketch-\\d+\\.png$`))
  assert.notEqual(first.files[0], second.files[0])
})
