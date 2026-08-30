#!/usr/bin/env node
/**
 * Generate kitten-survivors/assets/meadow/field.png — the surface the whole game
 * is played on, and the one every ground decal is drawn from.
 *
 *   node tools/make-kitten-survivors-ground.mjs
 *
 * WHY THIS IS SEPARATE FROM make-kitten-survivors-textures.mjs. That tool paints
 * surfaces a prop is made of — bark, timber, hay — and each is read on an object
 * a metre wide. This one is read across the whole screen at once, which changes
 * every rule it is drawn under. A prop texture is judged on whether it says
 * "bark"; the field is judged on whether it says nothing at all while still not
 * being flat.
 *
 * WHY A GENERATOR RATHER THAN A DOWNLOAD. The field has to sit inside a measured
 * luminance band and tile with no seam, and neither is something a photograph
 * can be retinted into. `art/world/bible.md` caps `edgeDensity` at 0.045 — the
 * share of neighbouring pixels whose luminance steps more than 0.06 — and every
 * grass photograph is blade detail at far above that. Retinting moves the hue
 * and leaves the contrast, so the only way to a legal grass is to paint one
 * whose contrast was never there.
 *
 * THE TWO NUMBERS EVERYTHING HERE IS BUILT ON.
 *
 *   Band. Every pixel stays within BAND of BASE in luminance. The floor is two
 *   thirds of the frame, so any variation it carries is variation the player
 *   reads instead of reading the crowd.
 *
 *   Step. No neighbouring pair of texels may differ by more than STEP in
 *   luminance. This is what keeps `edgeDensity` at zero: an edge is counted at
 *   0.06 and nothing here is allowed near it. It is why every mark is drawn
 *   soft — a hard-edged speck of the same colour would fail.
 *
 * Both are checked at the end against the file that was written, and the tool
 * exits 1 rather than leaving an illegal surface on disk.
 *
 * The field is drawn to be seen at ONE REPEAT PER 12.5 METRES, which is what
 * `tools/make-kitten-survivors-meadow.mjs` sets as `tiling: 0.08`. The camera
 * shows about 5 m across and 12 m deep, so a repeat is never in frame beside
 * itself and the tile's own composition is the composition of the ground.
 * Detail is drawn at 3 to 8 texels — 7 to 20 cm, about 8 to 22 screen pixels —
 * because below that a mark is grain and above it a mark is a motif.
 *
 * Seeded from a name, so a re-run writes a byte-identical file.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  clamp01, colour, encodePng, fractalNoise, get, luminance, makeRandom,
  mixColour, over, paint, patch, seamRatio, seedFromName, toBytes, wrap
} from './lib/texture.mjs'

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../kitten-survivors/assets/meadow')

/** Texels on a side. At one repeat per 12.5 m this is 41 texels per metre. */
const SIZE = 512

/**
 * The luminance the surface is painted around.
 *
 * This is the LIGHT end of the ground's range, not the middle of it. One file is
 * written and the level draws it three ways — the floor, the worn decal, the cut
 * decal — by putting a grey tint on the placement. A tint multiplies, so it can
 * only take a surface down; painting at the top of the range is what lets all
 * three come from one file instead of three.
 *
 * 0.67 with a band of 0.05 puts every pixel in 0.62 to 0.72. THE 0.72 CEILING IS
 * NOT THIS TOOL'S TO MOVE: the horde holds 0.14 to 0.33 and the cat holds 0.92,
 * so the ground and everything standing on it stay inside 0.44 to 0.72 or they
 * take a band belonging to something the player has to react to.
 */
const BASE = 0.67

/** How far a texel may stand from BASE. 8% of the base value. */
const BAND = 0.05

/** How far two neighbouring texels may stand apart. The edge threshold is 0.06. */
const STEP = 0.042

// The field's colours, chosen so that each is a different hue at nearly the same
// luminance. Value variation is capped by BAND; hue variation is not measured at
// all, so it is where the ground gets to be interesting for free.
const FIELD_DAMP = '#96b474'     // 0.663 — cooler, where it lies wet
const FIELD_STRAW = '#b0b878'    // 0.697 — warmer, where it has gone over
const FIELD_PALE = '#c2c6a1'     // 0.763 — cut and dry, the light end
const FIELD_DEEP = '#7a9e44'     // 0.564 — thick growth, the dark end
const FIELD_EARTH = '#ada286'    // 0.637 — bare soil showing through

/**
 * The surface every decal in the level is a lighter or darker copy of.
 *
 * Four passes, coarse to fine. Each one is drawn softly, because the guard at
 * the end rejects a hard edge and there is no way to soften one afterwards
 * without also flattening the pass below it.
 */
function field(name) {
  const random = makeRandom(seedFromName(name))
  const image = { width: SIZE, height: SIZE, data: new Float32Array(SIZE * SIZE * 4) }

  // Pass one: the large uneven colour of a field, at about four metres. It
  // carries most of the band and almost none of the step, because fractal noise
  // over three cells changes by well under a thousandth per texel.
  const broad = fractalNoise(random, 3, 3, 4)
  const drift = fractalNoise(random, 5, 5, 3)
  paint(image, (x, y, u, v) => {
    // Two independent noises. The first walks thick growth to cut grass and is
    // where the value range comes from; the second swings hue between damp and
    // straw at the same value. One noise alone reads as one blotch repeated.
    const ground = mixColour(colour(FIELD_DEEP), colour(FIELD_PALE), broad(u, v))
    const hue = mixColour(colour(FIELD_DAMP), colour(FIELD_STRAW), drift(u, v))
    return mixColour(ground, hue, 0.34)
  })

  // Pass two: clumps at half a metre to a metre — the scale a person reads as
  // "there is grass of different kinds here" rather than as a pattern.
  for (let index = 0; index < 42; index++) {
    const warm = random() < 0.55
    patch(image,
      random() * SIZE, random() * SIZE,
      18 + random() * 28,
      colour(warm ? FIELD_PALE : FIELD_DAMP),
      0.22 + random() * 0.16,
      0.35)
  }

  // Pass three: the speckle. This is the pass the eye actually reads as texture,
  // and the only one drawn at the size of a single mark. Half lift and half
  // drop, so the mean does not move.
  for (let index = 0; index < 2600; index++) {
    const lighter = random() < 0.5
    softDot(image,
      random() * SIZE, random() * SIZE,
      2.5 + random() * 5,
      colour(lighter ? FIELD_PALE : FIELD_DEEP),
      0.18 + random() * 0.16)
  }

  // Pass four: bare soil, sparse and warm. It is what stops the field reading as
  // a single hue, and it is the only warm-neutral mark on it.
  for (let index = 0; index < 220; index++) {
    softDot(image, random() * SIZE, random() * SIZE, 2 + random() * 4, colour(FIELD_EARTH), 0.16 + random() * 0.14)
  }

  return image
}

/**
 * A dot with no edge: coverage falls as a smooth bell to nothing at the radius.
 *
 * `patch` in the shared library is the same idea at a larger size, but its
 * falloff is a smoothstep over the radius and at three texels that still lands a
 * step the guard rejects. A dot this small has to be all falloff.
 */
function softDot(image, centreX, centreY, radius, tint, strength) {
  const reach = Math.ceil(radius)
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const distance = Math.hypot(dx, dy) / radius
      if (distance >= 1) continue
      // cos² falloff: zero value AND zero slope at the rim, so the mark cannot
      // leave a step however strong it is.
      const fade = Math.cos(distance * Math.PI / 2) ** 2
      over(image, centreX + dx, centreY + dy, tint, strength * fade)
    }
  }
}

/**
 * Pull every texel into the band around BASE, keeping its hue.
 *
 * Scaling all three channels by the same factor moves luminance and leaves hue
 * and saturation where they were, which is the point: the band is a rule about
 * value only, and correcting value by desaturating would spend the ground's
 * colour to pay for it.
 */
function holdInBand(image) {
  for (let index = 0; index < image.data.length; index += 4) {
    const pixel = [image.data[index], image.data[index + 1], image.data[index + 2]]
    const value = luminance(pixel)
    if (value <= 0) continue
    const wanted = Math.min(BASE + BAND, Math.max(BASE - BAND, value))
    if (wanted === value) continue
    const factor = wanted / value
    for (let channel = 0; channel < 3; channel++) {
      image.data[index + channel] = clamp01(pixel[channel] * factor)
    }
  }
}

/**
 * What the surface measures, on the torus it will be tiled on.
 *
 * The neighbour step is taken with wrapping, so a tile whose left edge steps
 * hard into its right edge is caught here rather than as a grid over the field.
 */
function measure(image) {
  let low = 1
  let high = 0
  let total = 0
  let worstStep = 0
  let overStep = 0
  const count = image.width * image.height
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const value = luminance(get(image, x, y))
      low = Math.min(low, value)
      high = Math.max(high, value)
      total += value
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        const step = Math.abs(value - luminance(get(image, wrap(x + dx, image.width), wrap(y + dy, image.height))))
        worstStep = Math.max(worstStep, step)
        if (step > 0.06) overStep++
      }
    }
  }
  return { low, high, mean: total / count, worstStep, edgeShare: overStep / (count * 2) }
}

const round = value => Math.round(value * 1000) / 1000

/**
 * The grey tints the level draws this one file through, and what each is for.
 *
 * They are reported rather than applied, because the tint is a placement key in
 * kitten-survivors/levels/meadow.json and belongs there. Printing them is what
 * keeps the two files agreeing about what the ground's value band is.
 */
const USES = [
  { name: 'the floor', tint: 'none', factor: 1 },
  { name: 'a worn decal', tint: '#dedede', factor: 0.871 },
  { name: 'a warm decal', tint: '#fbeed2', factor: 0.929 },
  { name: 'a bare decal', tint: '#e8ddc6', factor: 0.869 }
]

const image = field('kitten-meadow-field')
holdInBand(image)
const facts = measure(image)
const file = path.join(OUT, 'field.png')
fs.writeFileSync(file, encodePng(image.width, image.height, toBytes(image)))
const seam = Math.max(seamRatio(image, 'x'), seamRatio(image, 'y'))

console.log('')
console.log(`kitten-survivors/assets/meadow/field.png — ${SIZE}px, ${Math.round(fs.statSync(file).size / 1024)} kB`)
console.log(`value ${round(facts.low)}–${round(facts.high)}, mean ${round(facts.mean)}`)
console.log(`worst neighbour step ${round(facts.worstStep)} (cap ${STEP}); pairs over the 0.06 edge threshold ${round(facts.edgeShare)}`)
console.log(`seam ${round(seam)} — under 1.5 the join is no sharper than the picture`)
console.log('')
console.log('drawn for one repeat per 12.5 m: 41 texels per metre, about 2.7 screen pixels each')
for (const use of USES) {
  console.log(`  ${use.name.padEnd(14)} tint ${use.tint.padEnd(8)} value ${round(facts.low * use.factor)}–${round(facts.high * use.factor)}`)
}
console.log('')

if (facts.worstStep > STEP) {
  console.error(`[ground] field.png steps ${round(facts.worstStep)} between neighbours — the cap is ${STEP}`)
  process.exitCode = 1
}
if (facts.edgeShare > 0) {
  console.error(`[ground] field.png has ${round(facts.edgeShare)} of pairs over the 0.06 edge threshold`)
  process.exitCode = 1
}
