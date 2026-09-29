/**
 * see.capture tells a drawn frame from an empty one.
 *
 * The world canvas has a transparent background, so the scene is often a small
 * part of the frame. A frame with anything drawn on it must never read back as
 * empty, wherever the drawing sits; only a frame with no alpha at all is blank.
 *
 * Pure: a byte array. No page, no renderer.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { hasPixels } from '../plugins/builtin/see/capture-pixels.js'

const WIDTH = 800
const HEIGHT = 600

/** A transparent RGBA frame. */
const emptyFrame = () => new Uint8ClampedArray(WIDTH * HEIGHT * 4)

/** Give one pixel full alpha. */
function drawPixel(frame, x, y) {
  frame[(y * WIDTH + x) * 4 + 3] = 255
}

test('a frame with no alpha is empty', () => {
  assert.equal(hasPixels(emptyFrame()), false)
})

test('a single drawn pixel is found wherever it is', () => {
  for (const [x, y] of [[0, 0], [1, 0], [WIDTH - 1, 0], [123, 456], [WIDTH - 1, HEIGHT - 1]]) {
    const frame = emptyFrame()
    drawPixel(frame, x, y)
    assert.equal(hasPixels(frame), true, `pixel at ${x},${y}`)
  }
})

test('a thin platform under 1% of the frame is found', () => {
  const frame = emptyFrame()
  for (let x = 100; x < 400; x++) for (let y = 310; y < 322; y++) drawPixel(frame, x, y)
  assert.ok(300 * 12 < (WIDTH * HEIGHT) / 100, 'the platform covers under 1% of the frame')
  assert.equal(hasPixels(frame), true)
})
