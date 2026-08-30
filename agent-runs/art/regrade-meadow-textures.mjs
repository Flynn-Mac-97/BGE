#!/usr/bin/env node
/**
 * Regrade the meadow texture set to the world art direction.
 *
 *   node agent-runs/art/regrade-meadow-textures.mjs
 *
 * The set as painted measures too dark, too saturated and too busy for
 * kitten-survivors/art/world/bible.md: grass came back at value 0.63,
 * saturation 0.58 and edgeDensity 0.048, and the field rendered from it
 * measured value.p95 0.613 against a floor of 0.66 with saturation pinned at
 * 1.0. A saturated green cannot reach 0.66 luminance at any exposure, so the
 * fix is chroma and lift in the texture, not more light.
 *
 * Each surface is blurred on a torus, pulled toward its own mean, desaturated,
 * warmed and then scaled so its median luminance lands on a target. Blurring
 * first is what drops edgeDensity; the bible caps it at 0.045 and names it a
 * guard against answering a brightness failure with grain.
 *
 * It always reads the painted set kept in meadow-source/ beside it, never the
 * graded file, so running it twice writes the same bytes and a target can be
 * changed and re-run.
 *
 * It belongs in tools/, with the generator that paints the source set.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodePng } from '../../plugins/builtin/art-direction/image.js'
import { encodePng } from '../../tools/lib/texture.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const SOURCE = path.join(HERE, 'meadow-source')
const MEADOW = path.join(ROOT, 'kitten-survivors/assets/meadow')

/** What the direction warms every surface toward — daylight on a pale field, not a lamp. */
const WARM = [1, 0.95, 0.84]

/**
 * Per surface: the median luminance it must land on, how much chroma it keeps,
 * how far each pixel is pulled toward the surface mean, how wide the blur is,
 * and how much daylight is mixed in.
 *
 * The ground surfaces are the brightest and the flattest because they cover
 * most of the screen and must stay under the actors. Everything outside the
 * fence — bark, board, shingle — stays darker so the boundary reads as an edge.
 */
const TARGETS = {
  grass: { value: 0.74, chroma: 0.42, flatten: 0.40, blur: 4, warm: 0.16 },
  'grass-mown': { value: 0.82, chroma: 0.40, flatten: 0.35, blur: 4, warm: 0.20 },
  'grass-dry': { value: 0.80, chroma: 0.44, flatten: 0.35, blur: 5, warm: 0.22 },
  earth: { value: 0.63, chroma: 0.46, flatten: 0.50, blur: 3, warm: 0.18 },
  leaf: { value: 0.66, chroma: 0.50, flatten: 0.50, blur: 3, warm: 0.14 },
  moss: { value: 0.68, chroma: 0.46, flatten: 0.50, blur: 3, warm: 0.14 },
  stone: { value: 0.74, chroma: 0.55, flatten: 0.55, blur: 2, warm: 0.16 },
  timber: { value: 0.60, chroma: 0.52, flatten: 0.55, blur: 2, warm: 0.16 },
  hay: { value: 0.78, chroma: 0.46, flatten: 0.45, blur: 3, warm: 0.20 },
  bark: { value: 0.46, chroma: 0.58, flatten: 0.60, blur: 2, warm: 0.12 },
  pond: { value: 0.70, chroma: 0.58, flatten: 0.50, blur: 3, warm: 0.06 },
  'roof-shingle': { value: 0.52, chroma: 0.58, flatten: 0.60, blur: 2, warm: 0.10 },
  'barn-board': { value: 0.56, chroma: 0.60, flatten: 0.60, blur: 2, warm: 0.12 }
}

const clamp01 = value => (value < 0 ? 0 : value > 1 ? 1 : value)
const luminance = pixel => 0.2126 * pixel[0] + 0.7152 * pixel[1] + 0.0722 * pixel[2]

/** RGBA bytes to a float array of [r, g, b] rows, alpha kept aside. */
function toPixels(image) {
  const pixels = []
  const alpha = []
  for (let at = 0; at < image.width * image.height; at++) {
    pixels.push([image.data[at * 4] / 255, image.data[at * 4 + 1] / 255, image.data[at * 4 + 2] / 255])
    alpha.push(image.data[at * 4 + 3] / 255)
  }
  return { pixels, alpha }
}

/** A box blur that wraps, so the tile still meets itself at the seam. */
function blur(pixels, width, height, radius) {
  if (radius < 1) return pixels
  const pass = (source, horizontal) => {
    const out = new Array(source.length)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let red = 0, green = 0, blue = 0
        for (let step = -radius; step <= radius; step++) {
          const sampleX = horizontal ? (x + step + width * 8) % width : x
          const sampleY = horizontal ? y : (y + step + height * 8) % height
          const pixel = source[sampleY * width + sampleX]
          red += pixel[0]; green += pixel[1]; blue += pixel[2]
        }
        const count = radius * 2 + 1
        out[y * width + x] = [red / count, green / count, blue / count]
      }
    }
    return out
  }
  return pass(pass(pixels, true), false)
}

/** The median of a list, without sorting the caller's copy. */
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]

function regrade(image, target) {
  const { pixels, alpha } = toPixels(image)
  const soft = blur(pixels, image.width, image.height, target.blur)

  const mean = [0, 1, 2].map(channel => soft.reduce((sum, pixel) => sum + pixel[channel], 0) / soft.length)

  const graded = soft.map(pixel => {
    // Pull toward the surface mean: the two-tone grass split is most of what
    // reads as noise at one repeat per metre.
    const flat = pixel.map((channel, index) => mean[index] + (channel - mean[index]) * (1 - target.flatten))
    // Chroma down toward the pixel's own grey, so hue survives and loudness does not.
    const grey = luminance(flat)
    const quiet = flat.map(channel => grey + (channel - grey) * target.chroma)
    // Daylight mixed in, per the ruling that warmth comes from the sky.
    return quiet.map((channel, index) => channel + (WARM[index] - channel) * target.warm)
  })

  const lift = target.value / median(graded.map(luminance))
  const bytes = Buffer.alloc(image.width * image.height * 4)
  graded.forEach((pixel, at) => {
    for (let channel = 0; channel < 3; channel++) {
      bytes[at * 4 + channel] = Math.round(clamp01(pixel[channel] * lift) * 255)
    }
    bytes[at * 4 + 3] = Math.round(alpha[at] * 255)
  })
  return bytes
}

for (const [name, target] of Object.entries(TARGETS)) {
  const image = await decodePng(fs.readFileSync(path.join(SOURCE, `${name}.png`)))
  fs.writeFileSync(path.join(MEADOW, `${name}.png`), encodePng(image.width, image.height, regrade(image, target)))
  console.log(`${name}.png regraded to value ${target.value}, chroma ${target.chroma}, blur ${target.blur}`)
}
