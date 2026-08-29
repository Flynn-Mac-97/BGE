#!/usr/bin/env node
/**
 * Generate the Kitten Survivors meadow texture set.
 *
 *   node tools/make-kitten-survivors-textures.mjs
 *
 * The meadow is a dusk field a cat is about to be swarmed in, drawn chunky and
 * saturated. That sets what every texture here has to be: LOW CONTRAST and
 * MID VALUE. The screen will be full of enemies, and a ground that competes for
 * attention with the crowd is a ground that gets the player killed. So the whole
 * set is painted inside a narrow band — nothing darker than #2a4a28, nothing
 * lighter than #a8b862 — and the contrast that reads on screen comes from the
 * light and from the props standing on it, not from the picture.
 *
 * They are painted as CELLS rather than as grain, because the meadow is drawn
 * with the `toon` material and toon banding on top of fine noise reads as dirt
 * on the lens. Every surface here lays down a base colour, breaks it into a few
 * large quantised patches, draws the one structure the material actually has —
 * blades, boards, courses, shingles — and finishes with grain small enough to
 * disappear at a metre.
 *
 * Everything is generated on a torus: coordinates wrap modulo the size and every
 * lattice wraps with them, so a texture tiled across a 140 metre field never
 * draws a grid over it. The tool checks its own work with `seamRatio` and says so
 * on the console rather than leaving a bad tile to be found in the viewport.
 * `sky-dusk` is the exception and says so: it is one image wrapped once round the
 * world, so it joins on x and must not repeat up the sky.
 *
 * This is a build tool rather than game code, so `Math.random` would be allowed.
 * It still seeds its own generator from each texture's name, so that re-running
 * it leaves every file byte-identical and adding one texture does not rewrite the
 * other twelve.
 *
 * PNG is written by hand with node's own zlib, following
 * tools/make-counter-strike-textures.mjs, so the project keeps zero build
 * dependencies. That file's encoder is copied rather than imported because it is
 * a script that writes the whole de_dust2 set the moment it is loaded.
 */
import zlib from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../kitten-survivors/assets/meadow')

// --------------------------------------------------------------- determinism
/** mulberry32: small, fast, and good enough for texture noise. */
function makeRandom(seed) {
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
function seedFromName(name) {
  let hash = 0x811c9dc5
  for (let index = 0; index < name.length; index++) {
    hash ^= name.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** A repeatable value per grid cell — how one patch of grass gets its own tone. */
function hashCell(a, b, salt) {
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
const colour = hex => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255
]
const clamp01 = value => (value < 0 ? 0 : value > 1 ? 1 : value)
const mix = (a, b, amount) => a + (b - a) * amount
const mixColour = (a, b, amount) => [mix(a[0], b[0], amount), mix(a[1], b[1], amount), mix(a[2], b[2], amount)]
const scaleColour = (pixel, factor) => [clamp01(pixel[0] * factor), clamp01(pixel[1] * factor), clamp01(pixel[2] * factor)]
const smoothstep = t => t * t * (3 - 2 * t)
/** Rec.709, so pulling a pixel towards its own grey does not change how bright it looks. */
const luminance = pixel => 0.2126 * pixel[0] + 0.7152 * pixel[1] + 0.0722 * pixel[2]
const wrap = (value, size) => ((value % size) + size) % size
/** Shortest signed distance on a ring — how a patch drawn at the edge reaches round. */
const wrapDelta = (delta, size) => {
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
const quantise = (value, levels) => Math.round(clamp01(value) * (levels - 1)) / (levels - 1)

const WHITE = colour('#ffffff')

// --------------------------------------------------------------------- noise
/**
 * Value noise on a torus. The lattice index wraps modulo the cell count, so the
 * right edge interpolates back into the left one and the texture repeats with
 * no join. Separate counts per axis let grain be stretched along a board.
 */
function periodicNoise(random, cellsX, cellsY = cellsX) {
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
function fractalNoise(random, cellsX, cellsY = cellsX, octaves = 4) {
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
function surface(width, height) {
  return { width, height, data: new Float32Array(width * height * 4) }
}

const indexOf = (image, x, y) =>
  (wrap(Math.round(y), image.height) * image.width + wrap(Math.round(x), image.width)) * 4

function set(image, x, y, pixel, alpha = 1) {
  const at = indexOf(image, x, y)
  image.data[at] = clamp01(pixel[0])
  image.data[at + 1] = clamp01(pixel[1])
  image.data[at + 2] = clamp01(pixel[2])
  image.data[at + 3] = clamp01(alpha)
}

function get(image, x, y) {
  const at = indexOf(image, x, y)
  return [image.data[at], image.data[at + 1], image.data[at + 2]]
}

/** Ordinary source-over. Coordinates wrap, so anything drawn near an edge tiles. */
function over(image, x, y, pixel, alpha) {
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
function paint(image, shade) {
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const result = shade(x, y, x / image.width, y / image.height)
      if (result) set(image, x, y, result, result[3] === undefined ? 1 : result[3])
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
function patch(image, centreX, centreY, radius, tint, strength, wobble = 0.3) {
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
 * One blade, stroke or twig: a short tapering line drawn with wrapping pixels.
 *
 * Straight rather than curved on purpose. A meadow drawn from curved strokes
 * reads as fur; the plants in this art language are stiff chunky wedges, and a
 * straight taper is what makes a 256 pixel tile agree with a 0.35 metre box
 * standing on it.
 */
function blade(image, startX, startY, length, heading, thickness, tint, strength) {
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

/** Per-pixel grain, applied last and kept small. Grain first is what makes fuzz. */
function grain(image, random, amount) {
  const speck = periodicNoise(random, image.width, image.height)
  paint(image, (x, y, u, v) => scaleColour(get(image, x, y), 1 + (speck(u, v) - 0.5) * amount))
}

/**
 * Horizontal courses with a dark recess and a light catch along the top edge.
 *
 * Boards, planks and shingles are all this shape, so they share one function.
 * `rows` divides the tile exactly, which is what keeps the courses joining when
 * the texture repeats up a barn wall.
 */
function courses(image, { rows, columns, base, deep, light, jitter = 0.25, recess = 0.18, salt = 1 }) {
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

// ------------------------------------------------------------------ the field
/**
 * The meadow floor, and the most important texture in the game.
 *
 * Everything else is seen briefly or from far away; this is under the player for
 * the whole run. It is deliberately quiet: a saturated mid green, four levels of
 * large patchwork so a 140 metre field is not one flat colour, and blades sparse
 * enough that at one repeat per metre they read as texture rather than as a
 * pattern. Contrast is held under about twelve per cent, because every point of
 * contrast here is a point of contrast competing with an enemy.
 */
function grass(image, random) {
  const patchwork = fractalNoise(random, 4, 4, 3)
  const drift = fractalNoise(random, 2, 2, 2)

  const deep = colour('#2f6b30')
  const base = colour('#3c8138')
  const bright = colour('#4d9540')
  const dry = colour('#7d8f3e')

  paint(image, (x, y, u, v) => {
    const level = quantise(patchwork(u, v) * 0.75 + drift(u, v) * 0.25, 4)
    let pixel = mixColour(deep, bright, level)
    // A little warmth where the field is thinner, so the green is not one hue.
    pixel = mixColour(pixel, dry, 0.16 * clamp01(drift(u, v) * 1.6 - 0.7))
    return pixel
  })

  // Clumps: the large shapes the eye reads before it reads any blade.
  for (let index = 0; index < 26; index++) {
    const tint = random() < 0.5 ? deep : bright
    patch(image, random() * image.width, random() * image.height,
      12 + random() * 26, tint, 0.3 + random() * 0.22, 0.35)
  }

  // Blades last, short and mostly upright, in both a darker and a lighter tone
  // so the field has depth without having contrast.
  for (let index = 0; index < 900; index++) {
    const up = -Math.PI / 2 + (random() - 0.5) * 1.1
    const tint = random() < 0.45 ? scaleColour(base, 0.82) : scaleColour(bright, 1.1)
    blade(image, random() * image.width, random() * image.height,
      3 + random() * 5, up, 0.8, tint, 0.3 + random() * 0.25)
  }

  grain(image, random, 0.06)
}

/** Cut grass: the same field, lighter, with the mower's stripes still in it. */
function grassMown(image, random) {
  const patchwork = fractalNoise(random, 4, 4, 3)
  const base = colour('#4f9a41')
  const bright = colour('#63ac4c')
  const deep = colour('#3f8437')

  paint(image, (x, y, u, v) => {
    const level = quantise(patchwork(u, v), 3)
    let pixel = mixColour(deep, bright, level)
    // Four stripes across the tile: whole cycles, so they join when it repeats.
    const stripe = Math.sin(u * Math.PI * 2 * 2) * 0.5 + 0.5
    pixel = mixColour(pixel, base, quantise(stripe, 2) * 0.35)
    return pixel
  })

  for (let index = 0; index < 400; index++) {
    const up = -Math.PI / 2 + (random() - 0.5) * 0.8
    blade(image, random() * image.width, random() * image.height,
      2 + random() * 3, up, 0.7, scaleColour(bright, 1.08), 0.22)
  }
  grain(image, random, 0.05)
}

/** Late-summer straw: where the field has gone over, and the warm note in it. */
function grassDry(image, random) {
  const patchwork = fractalNoise(random, 5, 5, 3)
  const straw = colour('#9a9a4a')
  const pale = colour('#a8b862')
  const shade = colour('#6e7838')
  const green = colour('#5d8038')

  paint(image, (x, y, u, v) => {
    const level = quantise(patchwork(u, v), 4)
    let pixel = mixColour(shade, pale, level)
    pixel = mixColour(pixel, green, 0.22 * clamp01(patchwork(v, u) * 1.4 - 0.6))
    return pixel
  })

  for (let index = 0; index < 700; index++) {
    // Straw lies over further than living grass, which is most of what says it
    // is dead without changing the colour any more than it already is.
    const lean = -Math.PI / 2 + (random() - 0.5) * 2.1
    blade(image, random() * image.width, random() * image.height,
      4 + random() * 6, lean, 0.9, random() < 0.5 ? scaleColour(straw, 1.12) : shade, 0.3)
  }
  grain(image, random, 0.07)
}

/** Trodden earth: the path, and the ring of mud round the pond. */
function earth(image, random) {
  const lumps = fractalNoise(random, 5, 5, 4)
  const deep = colour('#4e3a28')
  const base = colour('#6b5136')
  const pale = colour('#836542')

  paint(image, (x, y, u, v) => {
    const level = quantise(lumps(u, v), 4)
    return mixColour(deep, pale, level)
  })

  for (let index = 0; index < 20; index++) {
    patch(image, random() * image.width, random() * image.height,
      8 + random() * 16, random() < 0.5 ? deep : base, 0.35, 0.4)
  }

  // Small stones pressed into the surface, each with its own shadow, because a
  // path with nothing hard in it reads as a carpet.
  for (let index = 0; index < 90; index++) {
    const x = random() * image.width
    const y = random() * image.height
    const radius = 0.8 + random() * 2.2
    const tone = mixColour(colour('#7d7466'), colour('#9a8f7d'), random())
    patch(image, x + radius * 0.4, y + radius * 0.5, radius * 1.1, deep, 0.5, 0.15)
    patch(image, x, y, radius, tone, 0.85, 0.2)
  }
  grain(image, random, 0.1)
}

/** Moss and the shaded green under a hedge. */
function moss(image, random) {
  const clumps = fractalNoise(random, 6, 6, 3)
  const deep = colour('#25482f')
  const base = colour('#33603a')
  const bright = colour('#417046')

  paint(image, (x, y, u, v) => mixColour(deep, bright, quantise(clumps(u, v), 3)))
  for (let index = 0; index < 40; index++) {
    patch(image, random() * image.width, random() * image.height,
      4 + random() * 10, random() < 0.5 ? base : bright, 0.4, 0.45)
  }
  grain(image, random, 0.08)
}

// ------------------------------------------------------------------ the hard
/** Chunky faceted stone: rocks, the dry wall, the standing stones. */
function stone(image, random) {
  const facets = fractalNoise(random, 4, 4, 2)
  const deep = colour('#4a4757')
  const base = colour('#65627a')
  const pale = colour('#7d7a92')

  paint(image, (x, y, u, v) => {
    // Three levels only. Stone in this language is FACETS — a rock is a few flat
    // planes catching different amounts of sky, and smooth shading undoes that.
    const level = quantise(facets(u, v), 3)
    return mixColour(deep, pale, level)
  })

  for (let index = 0; index < 14; index++) {
    patch(image, random() * image.width, random() * image.height,
      5 + random() * 12, random() < 0.5 ? deep : base, 0.4, 0.5)
  }
  // A pale lichen or two, the only warm note allowed on stone.
  for (let index = 0; index < 6; index++) {
    patch(image, random() * image.width, random() * image.height,
      2 + random() * 4, colour('#8d9463'), 0.4, 0.6)
  }
  grain(image, random, 0.09)
}

/** Weathered fence timber, grain running up the post. */
function timber(image, random) {
  const woodGrain = fractalNoise(random, 2, 12, 3)
  const deep = colour('#4b3a2a')
  const base = colour('#6d5741')
  const pale = colour('#8a7255')

  paint(image, (x, y, u, v) => {
    const level = quantise(woodGrain(u, v), 4)
    let pixel = mixColour(deep, pale, level)
    // Two splits down the post, at whole fractions so they join when it repeats.
    const split = Math.abs(Math.sin(u * Math.PI * 2 * 3))
    if (split < 0.06) pixel = mixColour(pixel, deep, 0.45 * (1 - split / 0.06))
    return mixColour(pixel, base, 0.2)
  })
  grain(image, random, 0.11)
}

/** Dark bark, near black at dusk, so a trunk reads as a silhouette. */
function bark(image, random) {
  const ridges = fractalNoise(random, 3, 10, 3)
  const deep = colour('#2c2018')
  const pale = colour('#4a3728')
  paint(image, (x, y, u, v) => mixColour(deep, pale, quantise(ridges(u, v), 3)))
  grain(image, random, 0.12)
}

/**
 * Canopy: clumps of leaf, opaque, drawn as flat masses.
 *
 * No alpha and no leaf shapes. A tree in this game is three boxes seen from
 * above at dusk, and cut-out leaves on a box read as a printed picture of a tree
 * rather than as one. Masses of two greens is what a lowpoly canopy is.
 */
function leaf(image, random) {
  const masses = fractalNoise(random, 4, 4, 3)
  const deep = colour('#1f4a2b')
  const base = colour('#2d6635')
  const bright = colour('#3d7c3c')

  paint(image, (x, y, u, v) => mixColour(deep, bright, quantise(masses(u, v), 4)))
  for (let index = 0; index < 30; index++) {
    patch(image, random() * image.width, random() * image.height,
      6 + random() * 14, random() < 0.5 ? deep : base, 0.45, 0.5)
  }
  grain(image, random, 0.07)
}

/** Barn boards: the one saturated red in the world, and it lives outside the fence. */
function barnBoard(image, random) {
  courses(image, {
    rows: 1, columns: 8, salt: 3, jitter: 0.4, recess: 0.5,
    base: colour('#9d3b2f'), deep: colour('#6d2620'), light: colour('#c05a44')
  })
  // Paint does not survive a field winter evenly; a few bare boards is what
  // stops eight identical planks reading as wallpaper.
  for (let index = 0; index < 10; index++) {
    patch(image, random() * image.width, random() * image.height,
      4 + random() * 10, colour('#7a4a34'), 0.35, 0.4)
  }
  grain(image, random, 0.09)
}

/** Roof shingles: dark, cool, and low contrast, so a roof is a shape not a pattern. */
function roofShingle(image, random) {
  courses(image, {
    rows: 6, columns: 8, salt: 5, jitter: 0.35, recess: 0.6,
    base: colour('#3b3a4c'), deep: colour('#262634'), light: colour('#4f4e63')
  })
  grain(image, random, 0.08)
}

/** Straw bale: warm, and the brightest thing outside the fence bar the barn. */
function hay(image, random) {
  const base = colour('#b2903f')
  const deep = colour('#7f6528')
  const pale = colour('#cfae5a')
  const strands = fractalNoise(random, 3, 6, 3)

  paint(image, (x, y, u, v) => mixColour(deep, pale, quantise(strands(u, v), 4)))
  for (let index = 0; index < 500; index++) {
    // Straw in a bale lies across it, so the strokes are near horizontal.
    const along = (random() - 0.5) * 0.5
    blade(image, random() * image.width, random() * image.height,
      4 + random() * 8, along, 0.7, random() < 0.5 ? base : pale, 0.3)
  }
  grain(image, random, 0.1)
}

/** Still water at dusk: violet sky in it, and the weed under it. */
function pond(image, random) {
  const ripple = fractalNoise(random, 3, 3, 3)
  const weed = fractalNoise(random, 7, 7, 2)
  const deep = colour('#2b4258')
  const sky = colour('#5f6392')
  const green = colour('#2f5148')

  paint(image, (x, y, u, v) => {
    let pixel = mixColour(deep, sky, quantise(ripple(u, v), 4))
    pixel = mixColour(pixel, green, 0.4 * clamp01(weed(u, v) * 1.5 - 0.75))
    return pixel
  })
  // A few bright reflections, which is the only place in the meadow anything is
  // allowed to be near white.
  for (let index = 0; index < 14; index++) {
    patch(image, random() * image.width, random() * image.height,
      1.5 + random() * 3, colour('#c9c0d8'), 0.4, 0.5)
  }
  grain(image, random, 0.05)
}

// -------------------------------------------------------------------- the sky
/**
 * Dusk, wrapped once round the world. Horizon at v = 0.5.
 *
 * The sun is a warm bloom low on one side rather than a disc, because a disc in
 * a panorama is a hard circle that never lines up with the key light and always
 * looks like a sticker. The gradient runs indigo at the zenith through violet to
 * apricot at the horizon, and below the horizon it goes straight to a dark
 * ground haze — nothing under the horizon is ever seen except through fog.
 */
function skyDusk(image, random) {
  const cloud = fractalNoise(random, 6, 3, 4)
  const edge = periodicNoise(random, 20, 6)

  const zenith = colour('#171a3e')
  const upper = colour('#312c60')
  const violet = colour('#5c4478')
  const rose = colour('#a05c76')
  const apricot = colour('#d98a5c')
  const ground = colour('#241f3a')

  // Where the sun sits, as a fraction round the panorama. It has to agree with
  // the level's key light direction, which comes from +X and +Z; a panorama's u
  // runs anticlockwise from -Z, so three eighths round puts the glow behind the
  // camera's right shoulder where the level puts the light.
  const sunU = 0.375

  paint(image, (x, y, u, v) => {
    let pixel
    if (v < 0.5) {
      // The warm band is kept in the last tenth of the sky on purpose. A dusk
      // whose orange reaches a third of the way up reads as a sunset poster; a
      // dusk whose orange is a thin line under a violet sky reads as evening,
      // and leaves the top two thirds dark enough for the arena to sit against.
      const down = v / 0.5
      pixel = mixColour(zenith, upper, smoothstep(clamp01(down * 1.6)))
      pixel = mixColour(pixel, violet, smoothstep(clamp01((down - 0.5) / 0.38)))
      pixel = mixColour(pixel, rose, clamp01((down - 0.86) / 0.11) ** 1.3)
      pixel = mixColour(pixel, apricot, clamp01((down - 0.965) / 0.035) ** 1.4)
    } else {
      // Below the horizon is only ever seen through fog, so it goes dark fast.
      const below = (v - 0.5) / 0.5
      pixel = mixColour(apricot, ground, smoothstep(clamp01(below * 5)))
    }

    // The sun's bloom, as an ellipse sitting on the horizon rather than a shaft
    // running up it. Wide across and shallow up, which is what a low sun in haze
    // actually is, and what keeps it from reading as a searchlight.
    const around = wrapDelta(u - sunU, 1)
    const above = 0.5 - v
    const glow = Math.exp(-((around / 0.115) ** 2 + (above / 0.055) ** 2))
    pixel = mixColour(pixel, colour('#f2b479'), 0.85 * glow)
    pixel = mixColour(pixel, colour('#ffdcae'), 0.9 * Math.exp(-((around / 0.035) ** 2 + (above / 0.016) ** 2)))

    // Bands of cloud, only in the upper half, thinning to nothing well above the
    // horizon so they never become a line lying along it.
    const band = clamp01((0.42 - v) / 0.34)
    const puff = clamp01((cloud(u, v) - 0.5) * 2.8 + 0.2 * (edge(u, v) - 0.5))
    const lit = mixColour(colour('#3d3462'), colour('#b8748a'), clamp01(1 - Math.abs(around) / 0.4))
    pixel = mixColour(pixel, lit, 0.6 * puff * smoothstep(band))

    // One step of dither: an eight-bit gradient over half a screen bands, and
    // the sky is the one surface with nothing on it to hide the bands.
    const dither = ((x * 7 + y * 13) % 3 - 1) / 255
    return [pixel[0] + dither, pixel[1] + dither, pixel[2] + dither]
  })
}

// ------------------------------------------------------------------- the list
// `wrap` says which axes a texture must join itself on.
//   'xy' a material, tiled both ways across a surface.
//   'x'  a composition down its height — the sky runs zenith to nadir and must
//        not repeat vertically.
// Sizes are powers of two because a wrapped mip chain wants them. Nothing here
// is a 1:1 picture: every one of these is a material.
const TEXTURES = [
  { name: 'grass', width: 256, height: 256, note: 'the field — under the player the whole run', draw: grass },
  { name: 'grass-mown', width: 128, height: 128, note: 'cut grass, mower stripes', draw: grassMown },
  { name: 'grass-dry', width: 128, height: 128, note: 'straw patches, the warm note in the field', draw: grassDry },
  { name: 'earth', width: 128, height: 128, note: 'the cart track and the pond edge', draw: earth },
  { name: 'moss', width: 64, height: 64, note: 'shade under the hedge', draw: moss },
  { name: 'stone', width: 64, height: 64, note: 'rocks, dry wall, standing stones', draw: stone },
  { name: 'timber', width: 64, height: 64, note: 'fence posts and rails', draw: timber },
  { name: 'bark', width: 64, height: 64, note: 'trunks, near black at dusk', draw: bark },
  { name: 'leaf', width: 128, height: 128, note: 'canopy masses, opaque', draw: leaf },
  { name: 'barn-board', width: 128, height: 128, note: 'the barn, the one saturated red', draw: barnBoard },
  { name: 'roof-shingle', width: 64, height: 64, note: 'barn roof, dark and cool', draw: roofShingle },
  { name: 'hay', width: 64, height: 64, note: 'bales and the stack', draw: hay },
  { name: 'pond', width: 64, height: 64, note: 'still water with the dusk sky in it', draw: pond },
  { name: 'sky-dusk', width: 1024, height: 512, note: 'panorama, horizon at v=0.5, sun glow at u=0.375', wrap: 'x', draw: skyDusk }
]

// ------------------------------------------------------------------ encoding
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let remainder = n
  for (let bit = 0; bit < 8; bit++) remainder = remainder & 1 ? 0xedb88320 ^ (remainder >>> 1) : remainder >>> 1
  return remainder >>> 0
})

const crc32 = buffer => {
  let remainder = 0xffffffff
  for (const byte of buffer) remainder = crcTable[(remainder ^ byte) & 0xff] ^ (remainder >>> 8)
  return (remainder ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/** @param bytes flat RGBA, four bytes per pixel, row-major */
function encodePng(width, height, bytes) {
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
function decodePngHeader(buffer) {
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

const toBytes = image => {
  const bytes = Buffer.alloc(image.width * image.height * 4)
  for (let index = 0; index < image.data.length; index++) bytes[index] = Math.round(clamp01(image.data[index]) * 255)
  return bytes
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
function seamRatio(image, axis) {
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
function averageColour(image) {
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

// --------------------------------------------------------------------- write
fs.mkdirSync(OUT, { recursive: true })

let failures = 0
const report = []

for (const texture of TEXTURES) {
  const { name, width, height, draw, wrap: wrapAxes = 'xy' } = texture
  const image = surface(width, height)
  try {
    draw(image, makeRandom(seedFromName(name)))
  } catch (error) {
    console.error(`[make-kitten-survivors-textures] ${name}.png failed to draw: ${error.message}`)
    failures++
    continue
  }

  const file = path.join(OUT, `${name}.png`)
  fs.writeFileSync(file, encodePng(width, height, toBytes(image)))

  // Read it back off disk rather than trusting what was just built in memory.
  const written = fs.readFileSync(file)
  try {
    const header = decodePngHeader(written)
    if (header.width !== width || header.height !== height) {
      throw new Error(`decoded ${header.width}x${header.height}, expected ${width}x${height}`)
    }
    if (header.bitDepth !== 8 || header.colourType !== 6) {
      throw new Error(`decoded bit depth ${header.bitDepth} colour type ${header.colourType}, expected 8 and 6`)
    }
    const powerOfTwo = value => (value & (value - 1)) === 0
    if (!powerOfTwo(width) || !powerOfTwo(height)) {
      throw new Error(`${width}x${height} wraps on "${wrapAxes}", so it must be a power of two on both axes`)
    }
    // The Skybox plugin maps a panorama onto a sphere and warns when it is not
    // wider than it is tall. Catch that here instead, where it is a build error.
    if (wrapAxes === 'x' && height >= width) {
      throw new Error(`${width}x${height} is a panorama, so it must be wider than it is tall`)
    }
  } catch (error) {
    console.error(`[make-kitten-survivors-textures] ${name}.png is not valid: ${error.message}`)
    failures++
    continue
  }

  const seams = { x: seamRatio(image, 'x'), y: seamRatio(image, 'y') }
  for (const axis of wrapAxes) {
    if (seams[axis] > 1.5) {
      console.error(
        `[make-kitten-survivors-textures] ${name}.png seams on ${axis}: the join is ${seams[axis].toFixed(2)}x ` +
        'the sharpest line inside the texture'
      )
      failures++
    }
  }

  report.push({ name, width, height, average: averageColour(image), wrapAxes, seams, bytes: written.length, note: texture.note })
}

// ------------------------------------------------------------------ manifest
// Printed so the next agent can pick a tint, a size and a reference string
// without opening a paint program. The reference matters: `assetPath` sends a
// bare name to assets/, so a texture in this folder is named "meadow/<name>.png"
// and resolves to kitten-survivors/assets/meadow/<name>.png.
const totalBytes = report.reduce((sum, entry) => sum + entry.bytes, 0)
console.log('')
console.log(`${report.length} textures in kitten-survivors/assets/meadow/, ${Math.round(totalBytes / 1024)} kB in total`)
console.log('reference them as meadow/<name>.png — a bare name is taken from the project\'s assets/')
console.log('')
console.log(`${'reference'.padEnd(32)}${'size'.padEnd(11)}${'average'.padEnd(10)}${'sat'.padEnd(7)}${'value'.padEnd(7)}${'seam'.padEnd(15)}note`)
for (const entry of report) {
  console.log(
    `meadow/${entry.name}.png`.padEnd(32) +
    `${entry.width}x${entry.height}`.padEnd(11) +
    entry.average.hex.padEnd(10) +
    entry.average.saturation.toFixed(2).padEnd(7) +
    entry.average.value.toFixed(2).padEnd(7) +
    entry.wrapAxes.split('').map(axis => `${axis}:${entry.seams[axis].toFixed(2)}`).join(' ').padEnd(15) +
    entry.note
  )
}
console.log('')

if (failures) {
  console.error(`[make-kitten-survivors-textures] ${failures} problem${failures === 1 ? '' : 's'} above`)
  process.exitCode = 1
}
