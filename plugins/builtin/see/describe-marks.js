import { screenHull, typeHue, hueHex } from '../../../engine/frame-facts.js'
// Bound both drawing clutter and the size of brief replies.
const MOST_MARKS = 40
const round = value => Math.round(value * 100) / 100
const byDepthThenId = (first, second) => first.depth - second.depth || (first.id < second.id ? -1 : first.id > second.id ? 1 : 0)

export function selectMarks(visible, population, subject) {
  visible.sort(byDepthThenId)
  const subjectEntry = subject && visible.find(entry => entry.id === subject.id)
  const subjectDepth = subjectEntry?.depth

  const candidates = visible.filter(entry => entry !== subjectEntry
    && entry.size[0] <= 50 && entry.size[1] <= 50
    && !(subjectDepth && entry.depth > subjectDepth * 8))

  const held = {}
  // Each type gets a first turn; later turns reflect its visible population.
  for (const entry of candidates) held[entry.type] = (held[entry.type] || 0) + 1
  const turn = new Map()
  const counted = {}
  for (const entry of candidates) {
    const nth = counted[entry.type] = (counted[entry.type] || 0) + 1
    turn.set(entry, 1 + (nth - 1) * population[entry.type] / held[entry.type])
  }
  candidates.sort((a, b) => turn.get(a) - turn.get(b)
    || population[a.type] - population[b.type] || byDepthThenId(a, b))

  const marked = []
  if (subjectEntry) { subjectEntry.mark = marked.push(subjectEntry) }
  for (const entry of candidates) {
    if (marked.length >= MOST_MARKS) break
    if (marked.some(other =>
      Math.abs(other.at[0] - entry.at[0]) < 4 && Math.abs(other.at[1] - entry.at[1]) < 5)) continue
    entry.mark = marked.push(entry)
  }
  return marked
}

export function addHulls(marked, projector) {
  for (const entry of marked) {
    const hull = screenHull(entry._world, projector)
    if (hull) {
      const simplified = simplifyHull(hull, Math.max(entry.size[0], entry.size[1]))
      if (simplified) entry.hull = simplified
    }
  }
}

export function markPalette(visible, marked) {
  const hues = new Map()
  for (const entry of visible) {
    if (!hues.has(entry.type)) hues.set(entry.type, typeHue(entry.type))
  }
  const markedTypes = [...new Set(marked.map(entry => entry.type))].sort()
  const palette = {}
  for (const type of markedTypes) {
    const own = hues.get(type)
    const distanceTo = hue => Math.min(...[...hues]
      .filter(([other]) => other !== type)
      .map(([, at]) => Math.min(Math.abs(at.hue - hue), 360 - Math.abs(at.hue - hue))), Infinity)
    let best = own.hue
    // Only choose a tested hue, including when no candidate clears its neighbours.
    let bestDistance = distanceTo(own.hue)
    for (let spins = 1; spins < 12 && bestDistance < 25; spins++) {
      const hue = (own.hue + spins * 37) % 360
      const distance = distanceTo(hue)
      if (distance > bestDistance) { best = hue; bestDistance = distance }
    }
    hues.set(type, { hue: best, bright: own.bright })
    palette[type] = hueHex(best, own.bright)
  }
  return { markedTypes, palette }
}

/** The share of a marked box that is on screen, as a fraction of its own area. */
export function clippedShare(entry) {
  const width = Math.min(100, entry.at[0] + entry.size[0] / 2) - Math.max(0, entry.at[0] - entry.size[0] / 2)
  const height = Math.min(100, entry.at[1] + entry.size[1] / 2) - Math.max(0, entry.at[1] - entry.size[1] / 2)
  return Math.max(0, width) * Math.max(0, height) / (entry.size[0] * entry.size[1] || 1)
}

export function addClipping(marked) {
  for (const entry of marked) {
    const shown = clippedShare(entry)
    if (shown < 0.999) entry.cut = round(shown * 100)
  }
}

const HULL_INVISIBLE_PERCENT = 0.6
const HULL_FULL_DETAIL_PERCENT = 15
const HULL_MIN_POINTS = 4
const HULL_MAX_POINTS = 8

export function simplifyHull(points, sizePercent) {
  if (sizePercent < HULL_INVISIBLE_PERCENT) return null
  const deduped = dropRepeatedPoints(points)
  if (deduped.length < 3) return null
  const grow = Math.min(1, sizePercent / HULL_FULL_DETAIL_PERCENT)
  const budget = Math.round(HULL_MIN_POINTS + (HULL_MAX_POINTS - HULL_MIN_POINTS) * grow)
  return decimate(deduped, Math.max(3, budget))
}

function dropRepeatedPoints(points) {
  const kept = points.filter((point, index) => index === 0
    || point[0] !== points[index - 1][0] || point[1] !== points[index - 1][1])
  const first = kept[0]
  const last = kept[kept.length - 1]
  if (kept.length >= 2 && first[0] === last[0] && first[1] === last[1]) kept.pop()
  return kept
}

function decimate(points, maxPoints) {
  const kept = [...points]
  while (kept.length > maxPoints) {
    let smallestArea = Infinity
    let smallestAt = -1
    for (let index = 0; index < kept.length; index++) {
      const before = kept[(index - 1 + kept.length) % kept.length]
      const point = kept[index]
      const after = kept[(index + 1) % kept.length]
      const area = Math.abs((point[0] - before[0]) * (after[1] - before[1])
        - (after[0] - before[0]) * (point[1] - before[1])) / 2
      if (area < smallestArea) { smallestArea = area; smallestAt = index }
    }
    kept.splice(smallestAt, 1)
  }
  return kept
}
