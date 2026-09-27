#!/usr/bin/env node
/**
 * Readback row order: a region and its rows read on a top-down backend
 * (WebGPU) come back as GL's bottom-up, so a studio frame is not upside down.
 *
 *   node --test test/core/render/readback-rows.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { bottomUpRows, regionAsRead } from '../../../engine/render/readback-rows.js'

test('a top-down read is turned to bottom-up rows; a bottom-up read is kept', () => {
  const topDown = Uint8Array.from([1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3])
  assert.deepEqual([...bottomUpRows(topDown, 1, 3, true)], [3, 3, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1])
  assert.equal(bottomUpRows(topDown, 1, 3, false), topDown)
})

test('a region from the bottom left is measured from the top for a top-down read', () => {
  const region = { x: 4, y: 10, width: 8, height: 20 }
  assert.deepEqual(regionAsRead(region, 100, true), { x: 4, y: 70, width: 8, height: 20 })
  assert.equal(regionAsRead(region, 100, false), region)
})
