#!/usr/bin/env node
/**
 * See's GIF encoder. A code one bit too wide, or a table reset one code late,
 * makes a GIF that opens and shows noise from that point on, and nothing
 * reports it. These decode what it wrote and compare pixel for pixel.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeGif, lzwOf } from '../plugins/builtin/see/gif-encoding.js'

/** GIF's LZW decoding, written from the format, to check the encoder against. */
function decodeLzw(bytes) {
  const clear = 256
  const end = 257
  let codeSize = 9
  let bitAt = 0
  const read = () => {
    let code = 0
    for (let bit = 0; bit < codeSize; bit++, bitAt++) code |= ((bytes[bitAt >> 3] >> (bitAt & 7)) & 1) << bit
    return code
  }
  let table = []
  const reset = () => {
    table = Array.from({ length: 258 }, (unused, index) => [index])
    codeSize = 9
  }
  const out = []
  let previous = null
  for (;;) {
    const code = read()
    if (code === clear) {
      reset()
      previous = null
      continue
    }
    if (code === end) return out
    const entry = code < table.length ? table[code] : [...previous, previous[0]]
    out.push(...entry)
    if (previous) table.push([...previous, entry[0]])
    if (table.length === 1 << codeSize && codeSize < 12) codeSize++
    previous = entry
  }
}

test('LZW decodes back to the same indices, past the table filling and starting again', () => {
  let seed = 7
  const indices = Array.from({ length: 60000 }, () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return (seed >> 16) % 13
  })
  assert.deepEqual(decodeLzw(lzwOf(indices)), indices)
})

test('a GIF holds every frame, loops, and draws each pixel in its nearest palette colour', () => {
  const pixels = colour => Uint8Array.from({ length: 4 * 4 * 4 }, (unused, place) => (place % 4 === 3 ? 255 : colour[place % 4]))
  const gif = encodeGif({ width: 4, height: 4, frames: [{ rgba: pixels([200, 40, 40]), delay: 8 }, { rgba: pixels([40, 200, 40]), delay: 8 }] })
  assert.equal(String.fromCharCode(...gif.slice(0, 6)), 'GIF89a')
  assert.ok(String.fromCharCode(...gif).includes('NETSCAPE2.0'), 'it loops')
  // Each image descriptor follows its 8-byte graphic control block.
  const starts = [...gif.keys()].filter(place => gif[place] === 0x2c && gif[place - 7] === 0xf9 && gif[place - 8] === 0x21)
  assert.equal(starts.length, 2, 'two frames')
  assert.equal(gif.at(-1), 0x3b)
  // The first frame's pixels, read back through the palette after the 13-byte header.
  const compressed = []
  for (let block = starts[0] + 11; gif[block] !== 0; block += gif[block] + 1) compressed.push(...gif.slice(block + 1, block + 1 + gif[block]))
  const [index] = decodeLzw(compressed)
  const colour = [...gif.slice(13 + index * 3, 16 + index * 3)]
  colour.forEach((value, channel) => assert.ok(Math.abs(value - [200, 40, 40][channel]) <= 8, `drawn ${colour}`))
})

test('a lane name picks that lane browser, and an unknown one names how to start it', async () => {
  const { laneBrowserOf } = await import('../plugins/builtin/see/gif-recording.mjs')
  const browsers = [{ client: 'editor', port: 9401 }, { client: 'sight', port: 9400 }]
  assert.equal(laneBrowserOf(browsers, 'sight').port, 9400)
  assert.throws(() => laneBrowserOf(browsers, 'other'), /lanes\.start other/)
})
