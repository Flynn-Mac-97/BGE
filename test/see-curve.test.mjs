#!/usr/bin/env node
/**
 * see.curve: engine curves drawn as a chart, headless. The picture is plain
 * pixels, so these check its size and that a curve's line is where its value
 * says, not how it looks.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { plotChart, plotSheet } from '../plugins/builtin/see/curve-plot.js'
import { seeCurve } from '../plugins/builtin/see/curve-command.js'
import { makeCurve } from '../engine/curves.js'

/** Whether any pixel of one column, between two rows, is the green of a curve's line. */
function hasLine(image, column, fromRow, endRow) {
  for (let row = fromRow; row <= endRow; row++) {
    const at = (row * image.width + column) * 4
    const [red, green, blue] = image.pixels.slice(at, at + 3)
    if (green > 150 && red < 150) return true
  }
  return false
}

test('a chart draws a rising line low on the left and high on the right', () => {
  const image = plotChart([{ label: 'linear', curve: makeCurve('fade-in') }], [400, 240])
  assert.equal(image.pixels.length, 400 * 240 * 4)
  assert.ok(hasLine(image, 45, 150, 215), 'the line starts near the bottom')
  assert.ok(hasLine(image, 375, 15, 60), 'and ends near the top')
})

test('a sheet has one named cell for each curve', () => {
  const image = plotSheet(
    ['pop', 'bob', 'flash'].map(label => ({ label, curve: makeCurve(label) })),
    2
  )
  assert.deepEqual(image.legend, ['pop', 'bob', 'flash'])
  assert.equal(image.width, 480)
  assert.equal(image.height, 340)
})

test('see.curve with nothing named lists every ease and preset, and refuses an unknown group', async () => {
  const listed = await seeCurve({})
  assert.ok(listed.eases.includes('back-out'))
  assert.equal(listed.presets.anticipate, 'motion')
  assert.match((await seeCurve({ group: 'dance' })).error, /no group "dance"/)
  assert.match((await seeCurve({ curve: 'wobble' })).error, /no preset "wobble"/)
})
