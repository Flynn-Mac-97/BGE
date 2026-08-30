#!/usr/bin/env node
/**
 * Generate the Kitten Survivors meadow texture set.
 *
 *   node tools/make-kitten-survivors-textures.mjs
 *
 * The meadow is a bright warm day a cat is about to be swarmed in, drawn flat
 * and chunky, sticker-book style. That sets what every texture here has to be:
 * LOW CONTRAST and LOW CHROMA. The screen will be full of enemies, and a ground
 * that competes for attention with the crowd is a ground that gets the player
 * killed — `arena-sits-under-the-actors` in the art bible. So every surface here
 * stays inside a few flat bands, and the contrast that reads on screen comes
 * from the light and from the props standing on it, not from the picture.
 *
 * They are painted as CELLS rather than as grain, because the meadow is drawn
 * with the `toon` material and toon banding on top of fine noise reads as dirt
 * on the lens. Every surface here lays down a base colour, breaks it into a
 * small number of quantised bands, draws the one structure the material
 * actually has — blades, boards, courses, shingles — and stops. `edgeDensity`
 * in the art bible caps at 0.045: detail here is not a virtue, it is a cost.
 *
 * Everything is generated on a torus: coordinates wrap modulo the size and every
 * lattice wraps with them, so a texture tiled across a 140 metre field never
 * draws a grid over it. The tool checks its own work with `seamRatio` and says so
 * on the console rather than leaving a bad tile to be found in the viewport.
 *
 * This is a build tool rather than game code, so `Math.random` would be allowed.
 * It still seeds its own generator from each texture's name, so that re-running
 * it leaves every file byte-identical and adding one texture does not rewrite
 * any other.
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

// The machinery — seeded random, noise, painting, encoding, seam checks — is
// shared. What is below is this meadow's own art direction.
import {
  BLACK, WHITE, averageColour, blade, chunk, clamp01,
  colour, courses, crack, crc32, crcTable, decodePngHeader,
  drawCourses, encodePng, fractalNoise, get, grain, grainPerPixel,
  groundShade, hashCell, indexOf, luminance, makeRandom, mix,
  mixColour, over, paint, patch, quantise,
  scaleColour, seamRatio, seedFromName, set, stain,
  surface, toBytes, weather, wrap
} from './lib/texture.mjs'


const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../kitten-survivors/assets/meadow')

// ------------------------------------------------------------------ the field
/**
 * The meadow floor, and the most important texture in the game.
 *
 * Everything else is seen briefly or from far away; this is under the player
 * for the whole run. Two flat bands of green, quantised large so a 140 metre
 * field is not one flat colour, and the blades carry the only real contrast —
 * a field with a second layer of blobby patches over that base read as
 * camouflage at the game camera, not as grass, so the base stays plain and the
 * blades do the work of saying "grass".
 */
function grass(image, random) {
  const patchwork = fractalNoise(random, 3, 3, 2)

  // Yellow-greens, all under 90 degrees of hue. A blue-green field measured
  // warmShare 0.05 against the eight references' 0.37 to 0.97, because a
  // blue-green field cannot read as sunlit whatever the lamp does.
  const deep = colour('#557a2e')
  const base = colour('#6b9437')
  const bright = colour('#8ab04a')

  paint(image, (x, y, u, v) => mixColour(deep, bright, quantise(patchwork(u, v), 2)))

  // Blades: short, mostly upright, in a darker and a lighter tone than the
  // field under them, so the field has depth without a second patch layer.
  for (let index = 0; index < 480; index++) {
    const up = -Math.PI / 2 + (random() - 0.5) * 1.0
    const tint = random() < 0.5 ? scaleColour(base, 0.78) : scaleColour(bright, 1.15)
    blade(image, random() * image.width, random() * image.height,
      3 + random() * 5, up, 0.9, tint, 0.4)
  }
}

/** Cut grass: the same field, lighter, with the mower's stripes still in it. */
function grassMown(image, random) {
  const patchwork = fractalNoise(random, 4, 4, 3)
  const base = colour('#86ae48')
  const bright = colour('#9dc158')
  const deep = colour('#6f9a3e')

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
  const straw = colour('#c8c46a')
  const pale = colour('#d6dc90')
  const shade = colour('#93a052')
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

/** Moss and the shaded green under a hedge, in the same warm daylight as the field. */
function moss(image, random) {
  const clumps = fractalNoise(random, 6, 6, 3)
  const deep = colour('#526635')
  const base = colour('#718f47')
  const bright = colour('#8fad5e')

  paint(image, (x, y, u, v) => mixColour(deep, bright, quantise(clumps(u, v), 3)))
  for (let index = 0; index < 40; index++) {
    patch(image, random() * image.width, random() * image.height,
      4 + random() * 10, random() < 0.5 ? base : bright, 0.4, 0.45)
  }
}

// ------------------------------------------------------------------ the hard
/** Chunky faceted stone: rocks, the dry wall, the standing stones. */
function stone(image, random) {
  const facets = fractalNoise(random, 4, 4, 2)
  // A warm grey, not the cool blue-grey of a dusk stone: this stone sits under
  // the same warm daylight as the field.
  const deep = colour('#666156')
  const base = colour('#8a8275')
  const pale = colour('#a69c8f')

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
  // A pale lichen or two, the one green note on the stone.
  for (let index = 0; index < 6; index++) {
    patch(image, random() * image.width, random() * image.height,
      2 + random() * 4, colour('#8d9463'), 0.4, 0.6)
  }
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

/** Dark bark, near black, so a trunk reads as a silhouette against the field. */
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
 * above in daylight, and cut-out leaves on a box read as a printed picture of a
 * tree rather than as one. Masses of two greens is what a lowpoly canopy is.
 * Yellow-green, under 90 degrees of hue, the same warm daylight family as the
 * field under it.
 */
function leaf(image, random) {
  const masses = fractalNoise(random, 4, 4, 3)
  const deep = colour('#456125')
  const base = colour('#658c35')
  const bright = colour('#83ad49')

  paint(image, (x, y, u, v) => mixColour(deep, bright, quantise(masses(u, v), 4)))
  for (let index = 0; index < 30; index++) {
    patch(image, random() * image.width, random() * image.height,
      6 + random() * 14, random() < 0.5 ? deep : base, 0.45, 0.5)
  }
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

/** Still water under a bright day sky: the day-sky blue in it, and the weed under it. */
function pond(image, random) {
  const ripple = fractalNoise(random, 3, 3, 3)
  const weed = fractalNoise(random, 7, 7, 2)
  // The sky colour the level sets is `#8ecae6`; this is that blue, darker where
  // the water is deep and lighter where it holds the sky.
  const deep = colour('#326070')
  const sky = colour('#88bad1')
  const green = colour('#658040')

  paint(image, (x, y, u, v) => {
    let pixel = mixColour(deep, sky, quantise(ripple(u, v), 4))
    pixel = mixColour(pixel, green, 0.4 * clamp01(weed(u, v) * 1.5 - 0.75))
    return pixel
  })
  // A few bright reflections, which is the only place in the meadow anything is
  // allowed to be near white.
  for (let index = 0; index < 14; index++) {
    patch(image, random() * image.width, random() * image.height,
      1.5 + random() * 3, colour('#f7f0da'), 0.4, 0.5)
  }
}

// ------------------------------------------------------------------- the list
// There is no sky texture here. The level sets `world.sky` to a flat colour
// and has no `skyTexture`, so a generated panorama would never be drawn — a
// dusk panorama shipped in this set once anyway, wrong for the daylight game
// and dead weight either way.
// `wrap` says which axes a texture must join itself on. Every texture below is
// 'xy', a material tiled both ways across a surface — nothing here is a 1:1
// picture. Sizes are powers of two because a wrapped mip chain wants them.
const TEXTURES = [
  { name: 'grass', width: 256, height: 256, note: 'the field — under the player the whole run', draw: grass },
  { name: 'grass-mown', width: 128, height: 128, note: 'cut grass, mower stripes', draw: grassMown },
  { name: 'grass-dry', width: 128, height: 128, note: 'straw patches, the warm note in the field', draw: grassDry },
  { name: 'earth', width: 128, height: 128, note: 'the cart track and the pond edge', draw: earth },
  { name: 'moss', width: 64, height: 64, note: 'shade under the hedge', draw: moss },
  { name: 'stone', width: 64, height: 64, note: 'rocks, dry wall, standing stones', draw: stone },
  { name: 'timber', width: 64, height: 64, note: 'fence posts and rails', draw: timber },
  { name: 'bark', width: 64, height: 64, note: 'trunks, near black', draw: bark },
  { name: 'leaf', width: 128, height: 128, note: 'canopy masses, opaque', draw: leaf },
  { name: 'barn-board', width: 128, height: 128, note: 'the barn, the one saturated red', draw: barnBoard },
  { name: 'roof-shingle', width: 64, height: 64, note: 'barn roof, dark and cool', draw: roofShingle },
  { name: 'hay', width: 64, height: 64, note: 'bales and the stack', draw: hay },
  { name: 'pond', width: 64, height: 64, note: 'still water with the day sky in it', draw: pond }
]

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
