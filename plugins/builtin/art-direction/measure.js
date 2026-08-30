/**
 * The numbers an art ruling is allowed to be made of.
 *
 * A reference and a game frame go through this same function, so a ruling
 * written off references can be tested against the game without anyone
 * re-deciding what "too bright" means. Every field here is a measurement. None
 * of them is a judgement, and nothing in this file scores anything.
 *
 * What is deliberately NOT here: whether a thing is beautiful, whether a
 * silhouette reads, whether a composition works. Those need an eye, and a
 * ruling that needs an eye is tagged `judged` and checked with a side-by-side
 * sheet instead. A measured badge on a judged rule is the failure this whole
 * plugin exists to prevent.
 */
import { eachPixel, neighbourStep } from './image.js'

/** Sides of the colour cube the palette is counted on. 6 gives 216 bins. */
const PALETTE_BINS = 6

/** Luminance steps the band count is taken at. A toon surface occupies few. */
const BAND_STEPS = 32

/** Luminance difference across neighbouring pixels that counts as an edge. */
const EDGE_STEP = 0.06

/** Below this saturation a pixel has no hue worth counting as warm or cool. */
const HUE_FLOOR = 0.15

const luminance = (red, green, blue) => 0.2126 * red + 0.7152 * green + 0.0722 * blue

const saturation = (red, green, blue) => {
  const high = Math.max(red, green, blue)
  return high === 0 ? 0 : (high - Math.min(red, green, blue)) / high
}

/** Degrees, 0 red, 120 green, 240 blue. Only asked of pixels above HUE_FLOOR. */
function hue(red, green, blue) {
  const high = Math.max(red, green, blue)
  const low = Math.min(red, green, blue)
  const span = high - low
  if (span === 0) return 0
  let degrees
  if (high === red) degrees = ((green - blue) / span) % 6
  else if (high === green) degrees = (blue - red) / span + 2
  else degrees = (red - green) / span + 4
  return (degrees * 60 + 360) % 360
}

const hex = (red, green, blue) => '#' + [red, green, blue]
  .map(channel => Math.round(channel * 255).toString(16).padStart(2, '0')).join('')

/** The value at a percentile of a sorted list. */
function at(sorted, fraction) {
  if (!sorted.length) return 0
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))))
  return round(sorted[index])
}

const round = value => Math.round(value * 1000) / 1000

/**
 * Every measurable fact about one image.
 *
 * The fields are named for the question they answer, because a ruling quotes
 * the field name and an agent reading the ruling should not have to open this
 * file to know what was measured.
 */
export function measureImage(image) {
  const values = []
  const saturations = []
  const bins = new Map()
  const bands = new Set()
  let warm = 0
  let hued = 0

  const counted = eachPixel(image, (red, green, blue) => {
    const value = luminance(red, green, blue)
    values.push(value)
    bands.add(Math.round(value * (BAND_STEPS - 1)))

    const strength = saturation(red, green, blue)
    saturations.push(strength)
    if (strength >= HUE_FLOOR) {
      hued++
      const degrees = hue(red, green, blue)
      if (degrees < 90 || degrees > 300) warm++
    }

    const bin = [red, green, blue]
      .map(channel => Math.min(PALETTE_BINS - 1, Math.floor(channel * PALETTE_BINS))).join(',')
    const bucket = bins.get(bin) || { red: 0, green: 0, blue: 0, count: 0 }
    bucket.red += red; bucket.green += green; bucket.blue += blue; bucket.count++
    bins.set(bin, bucket)
  })

  if (!counted) return { error: 'every sampled pixel was transparent', pixels: 0 }

  values.sort((a, b) => a - b)
  saturations.sort((a, b) => a - b)

  return {
    pixels: counted,
    size: [image.width, image.height],
    palette: topColours(bins, counted),
    value: {
      p05: at(values, 0.05), median: at(values, 0.5), p95: at(values, 0.95),
      // The working range of the picture. A flat, quiet surface is a small one.
      spread: round(at(values, 0.95) - at(values, 0.05))
    },
    saturation: { median: at(saturations, 0.5), p95: at(saturations, 0.95) },
    // Share of coloured pixels on the warm half of the wheel. Says at a glance
    // whether a picture is lit warm against cool shade or the other way round.
    warmShare: hued ? round(warm / hued) : 0,
    // How many of 32 luminance steps the picture occupies. A banded toon
    // surface occupies few; a photograph or a smooth gradient occupies most.
    bands: bands.size,
    edgeDensity: edgeDensity(image),
    haze: haze(image)
  }
}

/**
 * How much the far third of the frame is washed out against the near third.
 *
 * Distance fog and a light vignette both do the same thing to a picture — drain
 * chroma and squeeze value at the far edge — and neither shows up in a
 * whole-frame statistic, because the average of a hazed frame and a clean one
 * can be identical. Under a camera looking down at a floor, screen height is
 * distance, so the top third against the bottom third measures it directly.
 *
 * `chromaDrop` above about 0.1 is a frame whose distance is being painted out.
 */
function haze(image) {
  const band = pixel => {
    const row = Math.floor(pixel / image.width)
    if (row < image.height / 3) return 'far'
    return row > (image.height * 2) / 3 ? 'near' : null
  }
  const collected = { far: { saturation: [], value: [] }, near: { saturation: [], value: [] } }
  eachPixel(image, (red, green, blue, pixel) => {
    const where = band(pixel)
    if (!where) return
    collected[where].saturation.push(saturation(red, green, blue))
    collected[where].value.push(luminance(red, green, blue))
  })
  const median = list => (list.sort((a, b) => a - b), at(list, 0.5))
  if (!collected.far.value.length || !collected.near.value.length) return null
  const far = { saturation: median(collected.far.saturation), value: median(collected.far.value) }
  const near = { saturation: median(collected.near.saturation), value: median(collected.near.value) }
  return {
    far, near,
    chromaDrop: round(near.saturation - far.saturation),
    valueLift: round(far.value - near.value)
  }
}

/** Share of neighbouring pixel pairs that step more than EDGE_STEP. The detail budget. */
function edgeDensity(image) {
  let steps = 0
  let pairs = 0
  eachPixel(image, (red, green, blue, pixel) => {
    const step = neighbourStep(image, pixel)
    if (step === null) return
    pairs++
    if (step > EDGE_STEP) steps++
  })
  return pairs ? round(steps / pairs) : 0
}

/** The colours the picture is actually made of, biggest share first. */
function topColours(bins, counted, keep = 6) {
  return [...bins.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, keep)
    .map(bucket => ({
      hex: hex(bucket.red / bucket.count, bucket.green / bucket.count, bucket.blue / bucket.count),
      share: round(bucket.count / counted)
    }))
}

// ----------------------------------------------------------------- agreement

/** The fields worth comparing across references, and how close counts as agreeing. */
const COMPARED = [
  ['value.p05', 0.08], ['value.median', 0.08], ['value.p95', 0.08], ['value.spread', 0.12],
  ['saturation.median', 0.08], ['saturation.p95', 0.10],
  ['warmShare', 0.15], ['bands', 6], ['edgeDensity', 0.10],
  ['haze.chromaDrop', 0.10], ['haze.valueLift', 0.10]
]

export const readField = (facts, path) =>
  path.split('.').reduce((value, key) => (value == null ? value : value[key]), facts)

/**
 * Where the references agree, and where they do not.
 *
 * Agreement is the evidence a ruling is made of: if six pictures of the look
 * you want all keep saturation under a quarter, that is a fact about the look
 * and not an opinion. Disagreement is worth as much and must not be averaged
 * away — it names a decision nobody has made yet, and the director makes it.
 */
export function agreement(measured) {
  const usable = measured.filter(entry => entry.facts && !entry.facts.error)
  if (usable.length < 2) {
    return { references: usable.length, why: 'agreement needs at least two measured references' }
  }

  const agreed = []
  const split = []
  for (const [field, tolerance] of COMPARED) {
    const values = usable.map(entry => readField(entry.facts, field)).filter(value => typeof value === 'number')
    if (values.length < 2) continue
    const low = Math.min(...values)
    const high = Math.max(...values)
    const middle = [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
    const entry = { field, low: round(low), median: round(middle), high: round(high), spread: round(high - low) }
    if (high - low <= tolerance) agreed.push(entry)
    else split.push({ ...entry, tolerance })
  }

  return {
    references: usable.length,
    // A ruling written off one of these can name its field and its number.
    agreed,
    // Each of these is a choice the director owes an answer to.
    split,
    palette: usable.flatMap(entry => entry.facts.palette.slice(0, 3).map(swatch => swatch.hex))
  }
}

// --------------------------------------------------------------- the verdict

/** Does one measured ruling hold for these facts? Never called for a judged one. */
export function judge(ruling, facts) {
  const got = readField(facts, ruling.field)
  if (typeof got !== 'number') {
    return { id: ruling.id, ok: false, why: `no measured field named "${ruling.field}"` }
  }
  const wants = ruling.wants || {}
  const failures = []
  if (typeof wants.min === 'number' && got < wants.min) failures.push(`below min ${wants.min}`)
  if (typeof wants.max === 'number' && got > wants.max) failures.push(`above max ${wants.max}`)
  if (typeof wants.near === 'number') {
    const within = typeof wants.within === 'number' ? wants.within : 0.05
    if (Math.abs(got - wants.near) > within) failures.push(`not within ${within} of ${wants.near}`)
  }
  return { id: ruling.id, says: ruling.says, field: ruling.field, got: round(got), wants, ok: !failures.length, failures }
}
