/**
 * See: frames as an animated GIF, looping for ever.
 *
 *   encodeGif({ width, height, frames: [{ rgba, delay }] }) -> Uint8Array
 *
 * `rgba` is width x height x 4 bytes; `delay` is how long the frame shows, in
 * hundredths of a second. One palette serves every frame: the 255 colours
 * most used across them, each pixel drawn in the nearest. Editor frames are
 * flat shaded, so 255 colours lose little, and one palette keeps a colour
 * from flickering between frames.
 */

/** The most colours a GIF palette holds, less one slot kept unused. */
const PALETTE_SIZE = 255

/** A colour cut to 5 bits a channel, as one number: the palette's buckets. */
const bucketOf = (rgba, offset) => ((rgba[offset] >> 3) << 10) | ((rgba[offset + 1] >> 3) << 5) | (rgba[offset + 2] >> 3)

/** A bucket's middle colour, as [red, green, blue]. */
const colourOf = bucket => [((bucket >> 10) & 31) * 8 + 4, ((bucket >> 5) & 31) * 8 + 4, (bucket & 31) * 8 + 4]

/** The palette for every frame: the most used buckets' colours. */
function paletteOf(frames) {
  const counts = new Map()
  for (const { rgba } of frames)
    for (let offset = 0; offset < rgba.length; offset += 4) {
      const bucket = bucketOf(rgba, offset)
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1)
    }
  return [...counts]
    .sort((first, second) => second[1] - first[1])
    .slice(0, PALETTE_SIZE)
    .map(([bucket]) => colourOf(bucket))
}

/** Each frame's pixels as palette indices, each bucket's nearest colour found once. */
function indicesOf(rgba, palette, nearest) {
  const indices = new Uint8Array(rgba.length / 4)
  for (let offset = 0; offset < rgba.length; offset += 4) {
    const bucket = bucketOf(rgba, offset)
    if (!nearest.has(bucket)) {
      const wanted = colourOf(bucket)
      let best = 0
      let bestDistance = Infinity
      palette.forEach((colour, index) => {
        const distance = colour.reduce((sum, channel, place) => sum + (channel - wanted[place]) ** 2, 0)
        if (distance < bestDistance) [best, bestDistance] = [index, distance]
      })
      nearest.set(bucket, best)
    }
    indices[offset / 4] = nearest.get(bucket)
  }
  return indices
}

/**
 * GIF's LZW compression of 8-bit indices, as bytes. A code grows a bit when
 * the table reaches its size, and the table starts again at 4096 codes.
 */
export function lzwOf(indices) {
  const clear = 256
  const end = 257
  const bytes = []
  let codeSize = 9
  let next = end + 1
  let buffer = 0
  let bits = 0
  const table = new Map()
  const emit = code => {
    buffer |= code << bits
    bits += codeSize
    while (bits >= 8) {
      bytes.push(buffer & 255)
      buffer >>>= 8
      bits -= 8
    }
  }
  emit(clear)
  let prefix = indices[0]
  for (let place = 1; place < indices.length; place++) {
    const key = prefix * 256 + indices[place]
    if (table.has(key)) {
      prefix = table.get(key)
      continue
    }
    emit(prefix)
    if (next === 4096) {
      emit(clear)
      table.clear()
      codeSize = 9
      next = end + 1
    } else {
      if (next >= 1 << codeSize) codeSize++
      table.set(key, next++)
    }
    prefix = indices[place]
  }
  emit(prefix)
  emit(end)
  if (bits > 0) bytes.push(buffer & 255)
  return bytes
}

/** Add `bytes` to `into` one by one: a frame's bytes are too many to spread into one call. */
function append(into, bytes) {
  for (const byte of bytes) into.push(byte)
}

/** Add bytes as GIF sub-blocks: each at most 255 long, after its length, then an empty one. */
function appendSubBlocks(into, bytes) {
  for (let start = 0; start < bytes.length; start += 255) {
    const block = bytes.slice(start, start + 255)
    into.push(block.length)
    append(into, block)
  }
  into.push(0)
}

const littleEndian = value => [value & 255, (value >> 8) & 255]

/** The frames as a looping GIF. */
export function encodeGif({ width, height, frames }) {
  const palette = paletteOf(frames)
  const table = Array.from({ length: 256 }, (unused, index) => palette[index] ?? [0, 0, 0]).flat()
  const nearest = new Map()
  const bytes = [
    ...'GIF89a'.split('').map(letter => letter.charCodeAt(0)),
    ...littleEndian(width),
    ...littleEndian(height),
    0xf7, 0, 0,
    ...table,
    // NETSCAPE2.0: repeat for ever.
    0x21, 0xff, 11, ...'NETSCAPE2.0'.split('').map(letter => letter.charCodeAt(0)), 3, 1, 0, 0, 0
  ]
  for (const { rgba, delay } of frames) {
    bytes.push(0x21, 0xf9, 4, 0, ...littleEndian(Math.max(2, Math.round(delay))), 0, 0)
    bytes.push(0x2c, 0, 0, 0, 0, ...littleEndian(width), ...littleEndian(height), 0)
    bytes.push(8)
    appendSubBlocks(bytes, lzwOf(indicesOf(rgba, palette, nearest)))
  }
  bytes.push(0x3b)
  return Uint8Array.from(bytes)
}
