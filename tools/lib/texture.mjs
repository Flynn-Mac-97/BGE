/**
 * The machinery every texture generator needs, and none of the art direction.
 *
 * Both texture tools grew their own copy: 250 substantive lines were identical
 * between the counter-strike and kitten-survivors generators — the same seeded
 * random, the same hashes, the same noise, the same encoder. Copying is how one
 * thing ends up with three owners and no fixes. Those tools now live in their
 * own projects and import this file.
 *
 * Where the two copies had drifted, this file takes the newer spelling, because
 * every difference but one was a rename the house style asked for (`i` to
 * `index`, `d` to `distance`). The exception is `grain`, which the newer copy
 * rewrote to wrap on the torus — the older one lays per-pixel noise that does
 * not tile, so it draws a faint seam. `grainPerPixel` keeps the old behaviour
 * for the tool that already shipped textures made with it.
 *
 * Nothing here knows what it is painting. A palette, a structure and a list of
 * surfaces belong to a game; a torus-wrapped noise field does not.
 */
import zlib from 'node:zlib'




// --------------------------------------------------------------- determinism
/** mulberry32: small, fast, and good enough for texture noise. */
export function makeRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** FNV-1a over the texture's name, so each texture owns an independent stream. */
export function seedFromName(name) {
  let hash = 0x811c9dc5
  for (let index = 0; index < name.length; index++) {
    hash ^= name.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** A repeatable value per grid cell — how one patch of grass gets its own tone. */
export function hashCell(a, b, salt) {
  let hash = Math.imul(a + 0x9e3779b9, 0x85ebca6b)
  hash = Math.imul(hash ^ (b + 0xc2b2ae35), 0x27d4eb2f)
  hash = Math.imul(hash ^ (salt * 0x165667b1), 0x9e3779b1)
  hash ^= hash >>> 15
  return (hash >>> 0) / 4294967296
}

// -------------------------------------------------------------------- colour
// Colours are [red, green, blue] in 0..1 while a texture is painted, and become
// bytes only when it is encoded. Compositing in floats keeps a hundred small
// darkenings from banding into stripes.
export const colour = hex => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255
]

export const clamp01 = value => (value < 0 ? 0 : value > 1 ? 1 : value)

export const mix = (a, b, amount) => a + (b - a) * amount

export const mixColour = (a, b, amount) => [mix(a[0], b[0], amount), mix(a[1], b[1], amount), mix(a[2], b[2], amount)]

export const scaleColour = (pixel, factor) => [clamp01(pixel[0] * factor), clamp01(pixel[1] * factor), clamp01(pixel[2] * factor)]

export const smoothstep = t => t * t * (3 - 2 * t)

/** Rec.709, so pulling a pixel towards its own grey does not change how bright it looks. */
export const luminance = pixel => 0.2126 * pixel[0] + 0.7152 * pixel[1] + 0.0722 * pixel[2]

export const wrap = (value, size) => ((value % size) + size) % size

/** Shortest signed distance on a ring — how a patch drawn at the edge reaches round. */
export const wrapDelta = (delta, size) => {
  const distance = wrap(delta, size)
  return distance > size / 2 ? distance - size : distance
}

/**
 * Snap a 0..1 value to a small number of levels.
 *
 * This is the whole look. A meadow drawn from smooth noise reads as a
 * photograph blurred; the same noise snapped to four levels reads as a thing
 * somebody made out of flat pieces, which is what the rest of the art is.
 */
export const quantise = (value, levels) => Math.round(clamp01(value) * (levels - 1)) / (levels - 1)

// --------------------------------------------------------------------- noise
/**
 * Value noise on a torus. The lattice index wraps modulo the cell count, so the
 * right edge interpolates back into the left one and the texture repeats with
 * no join. Separate counts per axis let grain be stretched along a board.
 */
export function periodicNoise(random, cellsX, cellsY = cellsX) {
  const lattice = new Float32Array(cellsX * cellsY)
  for (let index = 0; index < lattice.length; index++) lattice[index] = random()
  const at = (ix, iy) => lattice[wrap(iy, cellsY) * cellsX + wrap(ix, cellsX)]
  return (u, v) => {
    const x = u * cellsX
    const y = v * cellsY
    const ix = Math.floor(x)
    const iy = Math.floor(y)
    const fx = smoothstep(x - ix)
    const fy = smoothstep(y - iy)
    return mix(
      mix(at(ix, iy), at(ix + 1, iy), fx),
      mix(at(ix, iy + 1), at(ix + 1, iy + 1), fx),
      fy
    )
  }
}

/** A few octaves of the above: the large uneven colour of a real field. */
export function fractalNoise(random, cellsX, cellsY = cellsX, octaves = 4) {
  const layers = []
  let amplitude = 1
  let total = 0
  for (let octave = 0; octave < octaves; octave++) {
    layers.push({ noise: periodicNoise(random, cellsX << octave, cellsY << octave), amplitude })
    total += amplitude
    amplitude *= 0.5
  }
  return (u, v) => {
    let sum = 0
    for (const layer of layers) sum += layer.noise(u, v) * layer.amplitude
    return sum / total
  }
}

// ------------------------------------------------------------------- surface
export function surface(width, height) {
  return { width, height, data: new Float32Array(width * height * 4) }
}

export const indexOf = (image, x, y) =>
  (wrap(Math.round(y), image.height) * image.width + wrap(Math.round(x), image.width)) * 4

export function set(image, x, y, pixel, alpha = 1) {
  const at = indexOf(image, x, y)
  image.data[at] = clamp01(pixel[0])
  image.data[at + 1] = clamp01(pixel[1])
  image.data[at + 2] = clamp01(pixel[2])
  image.data[at + 3] = clamp01(alpha)
}

export function get(image, x, y) {
  const at = indexOf(image, x, y)
  return [image.data[at], image.data[at + 1], image.data[at + 2]]
}

/** Ordinary source-over. Coordinates wrap, so anything drawn near an edge tiles. */
export function over(image, x, y, pixel, alpha) {
  const coverage = clamp01(alpha)
  if (coverage <= 0) return
  const at = indexOf(image, x, y)
  const behind = image.data[at + 3]
  const combined = coverage + behind * (1 - coverage)
  if (combined <= 0) return
  for (let channel = 0; channel < 3; channel++) {
    const under = image.data[at + channel] * behind * (1 - coverage)
    image.data[at + channel] = clamp01((pixel[channel] * coverage + under) / combined)
  }
  image.data[at + 3] = combined
}

/** Paint every pixel from a function of position. `u` and `v` are 0..1. */
export function paint(image, shade) {
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const result = shade(x, y, x / image.width, y / image.height)
      if (result) set(image, x, y, result, result[3] === undefined ? 1 : result[3])
    }
  }
}

/**
 * A large soft stain with an irregular edge. Aging reads best as a few big marks
 * rather than many small ones, so every texture here gets a handful of these.
 * The radius is modulated by noise sampled around a circle, which is continuous
 * where the angle comes back round, and the wrapping `over` carries it across the
 * tile edge.
 */
export function stain(image, centreX, centreY, radius, tint, strength, wobble) {
  const reach = Math.ceil(radius * 1.7)
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const distance = Math.hypot(dx, dy)
      if (distance > reach) continue
      const angle = Math.atan2(dy, dx)
      const shaped = radius * (0.7 + 0.55 * wobble((Math.cos(angle) + 1) / 2, (Math.sin(angle) + 1) / 2))
      const fade = 1 - clamp01((distance - shaped * 0.35) / (shaped * 0.65 + 0.001))
      if (fade <= 0) continue
      over(image, centreX + dx, centreY + dy, tint, strength * fade * fade)
    }
  }
}

/**
 * A soft irregular patch, used everywhere a field wants a change of tone.
 *
 * The radius is modulated by noise sampled around a circle, which is continuous
 * where the angle comes back round, and the wrapping `over` carries it across
 * the tile edge.
 */
export function patch(image, centreX, centreY, radius, tint, strength, wobble = 0.3) {
  const reach = Math.ceil(radius * 1.8)
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const distance = Math.hypot(dx, dy)
      if (distance > reach) continue
      const angle = Math.atan2(dy, dx)
      const edge = radius * (1 + wobble * Math.sin(angle * 3 + centreX) * Math.cos(angle * 2 - centreY))
      const falloff = 1 - smoothstep(clamp01(distance / Math.max(1, edge)))
      if (falloff <= 0) continue
      const x = centreX + dx
      const y = centreY + dy
      over(image, x, y, tint, falloff * strength)
    }
  }
}

/**
 * A wandering hairline. Cracks are what stop a flat plaster wall reading as a
 * gradient: they are the one high-contrast detail on an otherwise soft surface.
 */
export function crack(image, random, startX, startY, length, heading, tint, strength) {
  let x = startX
  let y = startY
  let direction = heading
  for (let step = 0; step < length; step++) {
    direction += (random() - 0.5) * 0.5
    x += Math.cos(direction)
    y += Math.sin(direction)
    const taper = 1 - step / length
    over(image, x, y, tint, strength * (0.45 + 0.55 * taper))
    if (random() < 0.35) over(image, x, y + 1, tint, strength * 0.35 * taper)
    // A crack forks now and then, which is what makes it read as a crack rather
    // than as a drawn line.
    if (random() < 0.02 && length > 20) {
      crack(image, random, x, y, Math.floor(length * 0.35), direction + (random() - 0.5) * 1.6, tint, strength * 0.7)
    }
  }
}

/**
 * One blade, stroke or twig: a short tapering line drawn with wrapping pixels.
 *
 * Straight rather than curved on purpose. A meadow drawn from curved strokes
 * reads as fur; the plants in this art language are stiff chunky wedges, and a
 * straight taper is what makes a 256 pixel tile agree with a 0.35 metre box
 * standing on it.
 */
export function blade(image, startX, startY, length, heading, thickness, tint, strength) {
  const steps = Math.max(2, Math.round(length * 2))
  for (let step = 0; step <= steps; step++) {
    const along = step / steps
    const x = startX + Math.cos(heading) * length * along
    const y = startY + Math.sin(heading) * length * along
    const width = thickness * (1 - along * 0.85)
    const fade = strength * (1 - along * 0.5)
    const reach = Math.ceil(width)
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const falloff = 1 - clamp01(Math.hypot(dx, dy) / Math.max(0.6, width))
        if (falloff <= 0) continue
        over(image, x + dx, y + dy, tint, falloff * fade)
      }
    }
  }
}

/**
 * Horizontal courses with a dark recess and a light catch along the top edge.
 *
 * Boards, planks and shingles are all this shape, so they share one function.
 * `rows` divides the tile exactly, which is what keeps the courses joining when
 * the texture repeats up a barn wall.
 */
export function courses(image, { rows, columns, base, deep, light, jitter = 0.25, recess = 0.18, salt = 1 }) {
  const rowHeight = image.height / rows
  const columnWidth = image.width / columns
  paint(image, (x, y, u, v) => {
    const row = Math.floor(y / rowHeight)
    // Every other course steps along by half a board, which is how a wall reads
    // as laid rather than as a grid.
    const shifted = x + (row % 2 ? columnWidth / 2 : 0)
    const column = Math.floor(shifted / columnWidth)
    const tone = hashCell(column, row, salt)
    let pixel = mixColour(base, deep, quantise(tone, 4) * jitter)

    const intoRow = (y - row * rowHeight) / rowHeight
    const intoColumn = (shifted - column * columnWidth) / columnWidth
    // The joint is dark and the top millimetre of each board catches the light.
    const joint = Math.min(intoRow, intoColumn, 1 - intoColumn) * rowHeight
    if (joint < 1.2) pixel = mixColour(pixel, deep, recess * (1 - joint / 1.2))
    if (intoRow > 0.03 && intoRow < 0.12) pixel = mixColour(pixel, light, 0.22)
    return pixel
  })
}

/**
 * Courses of blocks: the workhorse behind the sandstone, the tunnels and the
 * brick under the plaster.
 *
 * Recessed mortar, a light catch along the top of every block, a shadow under it,
 * a tone per block and chipped corners. The column and row counts divide the
 * texture and the row count is even, so the half-block stagger repeats when the
 * texture wraps rather than colliding with itself.
 */
export function drawCourses(image, spec) {
  const {
    random, columns, rows, mortarWidth, stagger = true,
    light, dark, mortar, chipChance = 0, roughness = 1.6, bevel = 0.16
  } = spec
  if (stagger && rows % 2 !== 0) throw new Error('a staggered wall needs an even row count to tile vertically')

  const joint = periodicNoise(random, columns * 8, rows * 8)
  const weather = fractalNoise(random, 3, 3)
  const face = periodicNoise(random, columns * 4, rows * 4)
  const cellWidth = image.width / columns
  const cellHeight = image.height / rows

  paint(image, (x, y, u, v) => {
    const blockY = Math.floor(y / cellHeight)
    const shift = stagger ? (blockY % 2) * cellWidth * 0.5 : 0
    const shiftedX = wrap(x - shift, image.width)
    const blockX = Math.floor(shiftedX / cellWidth)
    const localX = shiftedX - blockX * cellWidth
    const localY = y - blockY * cellHeight

    const tone = hashCell(blockX, blockY, 11)
    const wobble = (joint(u, v) - 0.5) * roughness
    const width = mortarWidth + wobble
    const edgeX = Math.min(localX, cellWidth - 1 - localX)
    const edgeY = Math.min(localY, cellHeight - 1 - localY)
    let edge = Math.min(edgeX, edgeY)

    // Chipped corners. One block in a few has a bite out of one corner, which is
    // where a dressed stone wall stops looking machine-cut.
    if (chipChance > 0 && hashCell(blockX, blockY, 23) < chipChance) {
      const which = Math.floor(hashCell(blockX, blockY, 29) * 4)
      const cornerX = which % 2 === 0 ? 0 : cellWidth - 1
      const cornerY = which < 2 ? 0 : cellHeight - 1
      const size = cellHeight * (0.16 + 0.2 * hashCell(blockX, blockY, 31))
      const distance = Math.hypot(localX - cornerX, localY - cornerY)
      if (distance < size * (0.75 + 0.5 * joint(u, v))) edge = Math.min(edge, width - 0.5)
    }

    const grit = (face(u, v) - 0.5) * 0.34 + (weather(u, v) - 0.5) * 0.42
    if (edge < width) {
      // The joint is in shadow, deepest at its middle, and holds a little of the
      // block colour so it does not read as a drawn black line.
      const depth = 1 - clamp01(edge / Math.max(width, 0.6))
      const stone = mixColour(dark, light, clamp01(0.3 + 0.4 * tone + grit))
      return mixColour(stone, mortar, 0.55 + 0.4 * depth)
    }

    let stone = mixColour(dark, light, clamp01(0.24 + 0.52 * tone + grit))
    const into = edge - width
    // Light catches the top arris of each block and the bottom of it falls away.
    if (localY - width < 3 && localY >= width) stone = mixColour(stone, WHITE, bevel * (1 - (localY - width) / 3))
    if (cellHeight - localY < width + 4) stone = mixColour(stone, BLACK, bevel * 0.8 * (1 - (cellHeight - localY - width) / 4))
    if (into < 1.5) stone = mixColour(stone, BLACK, 0.06)
    // Grime gathers at the base of every course. A tiling wall cannot carry one
    // gradient from its top to its bottom without seaming, so the darkening that
    // a real wall has near the ground lives per-block here, and the base of the
    // wall itself is what plaster-trim.png is for.
    stone = mixColour(stone, mortar, 0.16 * (localY / cellHeight) ** 2)
    return stone
  })
}

/**
 * The one vertical gradient a repeating texture is allowed to have.
 *
 * Real walls are dark and filthy along the bottom, where dust is kicked against
 * them, and bleached along the top. A ramp from one to the other cannot be said
 * on a tile, because the bottom row would meet the top row of the copy below it
 * at a step, and that step is the worst kind of seam — a horizontal line drawn
 * across every wall on the map.
 *
 * A cosine at the tile's own fundamental frequency has no such problem: it is
 * periodic by construction, and so is its slope, so it wraps with no join at all
 * and the seam check cannot even see it. Peaked at 0.78 down the tile it averages
 * 0.89 across the lower third and 0.19 across the upper one — which is a gradient
 * by any measure anyone would apply to it, and it costs nothing.
 */
export const groundShade = (v, peak = 0.78) => 0.5 + 0.5 * Math.cos(Math.PI * 2 * (v - peak))

/**
 * Sun and dust: the pass every stone, plaster and sand surface here ends with.
 *
 * Three corrections, none of which any single texture can make for itself.
 *
 *   chroma  pulls each pixel a fraction of the way to its own brightness. Dust2
 *           sandstone is nearly grey-brown in shade and bleached almost white in
 *           the sun; a painted tan is neither. This is the knob the manifest's
 *           saturation column exists to let you check.
 *
 *   grime   `groundShade` above, mixed towards a grey-brown, so the bottom of
 *           the tile is dirty and the top is not. This is the single change that
 *           does most for a wall, because a uniformly lit surface reads as a
 *           material sample and a shaded one reads as a place.
 *
 *   drift   slow value noise over two cells of the whole tile. Not grain — grain
 *           is per-pixel and does nothing about the impression that a wall is one
 *           flat panel. This is what makes some blocks lighter than others for no
 *           reason you can name, and it is what stops a course of stone reading
 *           as a pattern when it is tiled nine times.
 *
 * It runs after a texture has drawn its structure and its stains, and before the
 * grain, so the grain stays the finest thing in the picture.
 */
export function weather(image, random, spec = {}) {
  const {
    chroma = 0.4,
    grime = 0.24, grimeColour = colour('#4b463b'), peak = 0.78,
    bleach = 0.1, bleachColour = colour('#eae5d8'),
    drift = 0.11, driftCells = 2
  } = spec
  const slow = fractalNoise(random, driftCells, driftCells, 3)
  paint(image, (x, y, u, v) => {
    let pixel = get(image, x, y)
    if (chroma > 0) {
      const grey = luminance(pixel)
      pixel = [mix(pixel[0], grey, chroma), mix(pixel[1], grey, chroma), mix(pixel[2], grey, chroma)]
    }
    const low = groundShade(v, peak)
    if (grime > 0) pixel = mixColour(pixel, grimeColour, grime * low)
    if (bleach > 0) pixel = mixColour(pixel, bleachColour, bleach * (1 - low))
    if (drift > 0) pixel = scaleColour(pixel, 1 + drift * (slow(u, v) * 2 - 1))
    return pixel
  })
}

/** Per-pixel grain, applied last and kept small. Grain first is what makes fuzz. */
export function grain(image, random, amount) {
  const speck = periodicNoise(random, image.width, image.height)
  paint(image, (x, y, u, v) => scaleColour(get(image, x, y), 1 + (speck(u, v) - 0.5) * amount))
}

// ------------------------------------------------------------------ encoding
export const crcTable = Array.from({ length: 256 }, (_, n) => {
  let remainder = n
  for (let bit = 0; bit < 8; bit++) remainder = remainder & 1 ? 0xedb88320 ^ (remainder >>> 1) : remainder >>> 1
  return remainder >>> 0
})

export const crc32 = buffer => {
  let remainder = 0xffffffff
  for (const byte of buffer) remainder = crcTable[(remainder ^ byte) & 0xff] ^ (remainder >>> 8)
  return (remainder ^ 0xffffffff) >>> 0
}

export function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/** @param bytes flat RGBA, four bytes per pixel, row-major */
export function encodePng(width, height, bytes) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8      // bit depth
  header[9] = 6      // colour type: RGBA
  // 10, 11, 12 stay 0: deflate, adaptive filtering, no interlace

  const raw = Buffer.alloc(height * (1 + width * 4))
  for (let y = 0; y < height; y++) {
    const at = y * (1 + width * 4)
    raw[at] = 0      // filter: none
    bytes.copy(raw, at + 1, y * width * 4, (y + 1) * width * 4)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/**
 * Read a written file back and say what is actually in it. Writing a header is
 * not proof the header is right, and a texture that decodes to the wrong size
 * fails silently as a stretched wall rather than as an error.
 */
export function decodePngHeader(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (!buffer.subarray(0, 8).equals(signature)) throw new Error('not a PNG: the signature is wrong')
  if (buffer.toString('ascii', 12, 16) !== 'IHDR') throw new Error('not a PNG: the first chunk is not IHDR')
  if (buffer.toString('ascii', buffer.length - 8, buffer.length - 4) !== 'IEND') throw new Error('truncated: no IEND')
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bitDepth: buffer[24],
    colourType: buffer[25]
  }
}

// -------------------------------------------------------------------- checks
/**
 * How visible the join is, in the units of the texture's own detail.
 *
 * The mean difference between the two lines that meet when the texture repeats,
 * over the largest mean difference between any neighbouring pair inside it.
 * Below about 1.5 the join is no more of a line than anything else in the
 * picture; a texture that seams scores several times that, because a seam is by
 * definition the sharpest edge in the image.
 */
export function seamRatio(image, axis) {
  const across = axis === 'x' ? image.width : image.height
  const along = axis === 'x' ? image.height : image.width
  const differences = new Float64Array(across)
  for (let line = 0; line < across; line++) {
    let total = 0
    for (let step = 0; step < along; step++) {
      const here = axis === 'x' ? indexOf(image, line, step) : indexOf(image, step, line)
      const next = axis === 'x' ? indexOf(image, line + 1, step) : indexOf(image, step, line + 1)
      for (let channel = 0; channel < 3; channel++) {
        total += Math.abs(image.data[here + channel] - image.data[next + channel])
      }
    }
    differences[line] = total / along
  }
  const join = differences[across - 1]
  let worstInside = 0
  for (let line = 0; line < across - 1; line++) worstInside = Math.max(worstInside, differences[line])
  return worstInside <= 0 ? 0 : join / worstInside
}

/** Average colour and saturation, so the manifest can report what was painted. */
export function averageColour(image) {
  let red = 0, green = 0, blue = 0
  const pixels = image.width * image.height
  for (let index = 0; index < image.data.length; index += 4) {
    red += image.data[index]
    green += image.data[index + 1]
    blue += image.data[index + 2]
  }
  const pixel = [red / pixels, green / pixels, blue / pixels]
  const high = Math.max(...pixel)
  const low = Math.min(...pixel)
  const byte = value => Math.round(clamp01(value) * 255).toString(16).padStart(2, '0')
  return {
    hex: `#${byte(pixel[0])}${byte(pixel[1])}${byte(pixel[2])}`,
    saturation: high <= 0 ? 0 : (high - low) / high,
    value: luminance(pixel)
  }
}

export const toBytes = image => {
  const bytes = Buffer.alloc(image.width * image.height * 4)
  for (let index = 0; index < image.data.length; index++) bytes[index] = Math.round(clamp01(image.data[index]) * 255)
  return bytes
}

/** The older, non-wrapping grain. Kept so already-shipped textures stay byte-identical. */
/** Per-pixel grain. Always last, always small. */
export function grainPerPixel(image, random, amount) {
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const at = indexOf(image, x, y)
      const noise = (random() - 0.5) * amount
      for (let channel = 0; channel < 3; channel++) image.data[at + channel] = clamp01(image.data[at + channel] + noise)
    }
  }
}

// Declared last: `colour` is defined above, and a const cannot be read before it.
export const BLACK = colour('#000000')
export const WHITE = colour('#ffffff')
