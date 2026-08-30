/**
 * The See index: everything computable about what a camera would show, as one
 * JSON description. This is the plugin's ground truth — every query verb and
 * every image starts here, and nothing here reads a renderer or a clock.
 */
import { makeProjector } from '../../../engine/camera-project.js'
import { boundsOf, frameSubject, facingOffset, boxesTouch, screenHull, typeHue, hueHex } from '../../../engine/frame-facts.js'

/**
 * Marks past this are noise: outlines crowd each other, and a `brief` reply —
 * a mark, a hull and a screen box each — grows past what an agent can read in
 * one go. Forty keeps a busy meadow's brief under eight kilobytes.
 */
const MOST_MARKS = 40

export function describe(context, options = {}) {
  const view = { ...context.view, ...(options.camera || {}) }
  let subject = null
  if (options.subject) {
    subject = context.world.byId(options.subject)
    if (!subject) return { error: `no entity "${options.subject}"` }
    Object.assign(view, frameSubject(subject, boundsOf(subject), options.shot), options.camera || {})
    if (view.mode === 'third-person-still') view.mode = 'perspective'
  }
  const projector = makeProjector(view, context.viewport)

  const visible = []
  const offscreenByType = {}
  /** How many of each type the level holds, on screen or off — its commonness. */
  const population = {}
  for (const entity of context.world.entities) {
    if (entity.hidden && !options.includeHidden) continue
    if (subject && options.alone && entity.id !== subject.id) continue
    population[entity.type] = (population[entity.type] || 0) + 1
    const point = projector.place(entity.x, entity.y, entity.z || 0)
    const bounds = boundsOf(entity)
    // A tilted camera sees a mix of an entity's height and its footprint: at
    // straight-down pitch the length IS the on-screen height.
    const tilt = projector.mode === 'ortho' ? 0 : Math.abs(view.pitch || 0)
    const seenHeight = bounds.h * Math.cos(tilt) + bounds.l * Math.sin(tilt)
    const size = projector.sizeAt(point.depth, bounds.w, seenHeight)
    const onScreen = point.inFront
      && point.x > -size.w / 2 && point.x < 100 + size.w / 2
      && point.y > -size.h / 2 && point.y < 100 + size.h / 2
    if (!onScreen) {
      offscreenByType[entity.type] = (offscreenByType[entity.type] || 0) + 1
      continue
    }
    visible.push({
      id: entity.id, type: entity.type,
      at: [round(point.x), round(point.y)],
      size: [round(size.w), round(size.h)],
      depth: round(point.depth),
      _world: { x: entity.x, y: entity.y, z: entity.z || 0, ...bounds }
    })
  }

  // A mark is how an answer binds to a body, so marks must fall where a
  // question would fall. Largest-on-screen spent every one of them on the
  // backdrop: a meadow's hills sit near the lens and draw wider than any rat
  // that matters. Marks are dealt out by TYPE instead, on two rules.
  //
  // Every type on screen takes its first mark before any type takes a second,
  // rarest type first, so the palette legend covers the whole frame within one
  // round and no visible kind goes unnamed.
  //
  // After that a type's turn comes round every `population / on screen` marks
  // — how many of it the level holds for each one the camera is showing. A
  // type the camera holds all of is what the frame is about; a type it holds a
  // twenty-fifth of is a sea of scenery being sampled, and one outline says as
  // much about it as thirty would. Within a type the nearest goes first: near
  // is what a question is about, and what a reader can make an outline out of.

  // Nearest first is also the order a reader reads the list in, and the order
  // an image strokes the hulls in, so the near ones land on top.
  visible.sort(byDepthThenId)
  const subjectEntry = subject && visible.find(entry => entry.id === subject.id)
  const subjectDepth = subjectEntry?.depth

  // A thing wider or taller than half the frame is a backdrop, not a subject,
  // and in a subject shot the horizon is context rather than content. Neither
  // can hold a mark, so neither takes a turn either — a type's turn must not
  // be spent on a body that was never going to be marked.
  const candidates = visible.filter(entry => entry !== subjectEntry
    && entry.size[0] <= 50 && entry.size[1] <= 50
    && !(subjectDepth && entry.depth > subjectDepth * 8))

  const held = {}
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
  // The subject of a subject shot is always mark 1 — the question is about it.
  if (subjectEntry) { subjectEntry.mark = marked.push(subjectEntry) }
  for (const entry of candidates) {
    if (marked.length >= MOST_MARKS) break
    // Two marks landing on the same few percent of screen draw over each
    // other's outline, so a mark also needs clear screen distance from every
    // mark already given.
    if (marked.some(other =>
      Math.abs(other.at[0] - entry.at[0]) < 4 && Math.abs(other.at[1] - entry.at[1]) < 5)) continue
    entry.mark = marked.push(entry)
  }

  // A tag floating above a thing is a guess about what it tags; a hull IS the
  // thing's screen shape. Every marked entry carries one, and `palette` maps
  // each marked type to the one colour every See drawing strokes it with —
  // one colour per TYPE, so a busy frame is a handful of colours, not a
  // hundred. Hues come from the type's name hash, so a type keeps its colour
  // between frames — but two names can hash together (kitten and ground do),
  // and a hull the colour of its backdrop marks nothing. A marked type whose
  // hue lands within 25 degrees of any other visible type's is walked around
  // the wheel until it stands clear; marked types are visited sorted, so the
  // outcome is deterministic.
  for (const entry of marked) {
    const hull = screenHull(entry._world, projector)
    if (hull) entry.hull = hull
  }
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
    // Only a probed hue is ever assigned; when no probe stands clear, the
    // best of them wins — never an unchecked thirteenth value.
    let best = own.hue
    let bestDistance = distanceTo(own.hue)
    for (let spins = 1; spins < 12 && bestDistance < 25; spins++) {
      const hue = (own.hue + spins * 37) % 360
      const distance = distanceTo(hue)
      if (distance > bestDistance) { best = hue; bestDistance = distance }
    }
    hues.set(type, { hue: best, bright: own.bright })
    palette[type] = hueHex(best, own.bright)
  }

  const coverage = {}
  for (const entry of visible) {
    coverage[entry.type] = round((coverage[entry.type] || 0)
      + Math.min(100, entry.size[0]) * Math.min(100, entry.size[1]) / 100)
  }

  // Whether two bodies interpenetrate is a fact about world boxes, not a
  // judgement — answered here so nobody asks a vision model to eyeball it.
  // Marked entities only: that is what a question names, and it bounds the
  // pair count. `occlusions` is the screen version: whose tag sits on a thing
  // that is actually behind another — [nearer, farther] pairs.
  const overlaps = []
  const occlusions = []
  for (let a = 0; a < marked.length; a++) {
    for (let b = a + 1; b < marked.length; b++) {
      if (boxesTouch(marked[a]._world, marked[b]._world)) {
        overlaps.push([marked[a].id, marked[b].id])
      }
      const near = marked[a].depth <= marked[b].depth ? marked[a] : marked[b]
      const far = near === marked[a] ? marked[b] : marked[a]
      if (far.depth - near.depth > 0.5
        && Math.abs(near.at[0] - far.at[0]) < (near.size[0] + far.size[0]) / 2
        && Math.abs(near.at[1] - far.at[1]) < (near.size[1] + far.size[1]) / 2) {
        occlusions.push([near.id, far.id])
      }
    }
  }

  // Where things are, in the words a question uses: a 3x3 grid of counts by
  // type, so "the enemies are all top-left" is read, not judged.
  const regions = {}
  for (const entry of visible) {
    const column = entry.at[0] < 33.3 ? 'left' : entry.at[0] < 66.6 ? 'centre' : 'right'
    const row = entry.at[1] < 33.3 ? 'top' : entry.at[1] < 66.6 ? 'middle' : 'bottom'
    const cell = row === 'middle' && column === 'centre' ? 'centre' : `${row}-${column}`
    regions[cell] = regions[cell] || {}
    regions[cell][entry.type] = (regions[cell][entry.type] || 0) + 1
  }

  // How much of a marked thing is actually inside the frame. Only said when
  // it is cut, so an uncut frame costs nothing extra to read.
  for (const entry of marked) {
    const clippedW = Math.min(100, entry.at[0] + entry.size[0] / 2) - Math.max(0, entry.at[0] - entry.size[0] / 2)
    const clippedH = Math.min(100, entry.at[1] + entry.size[1] / 2) - Math.max(0, entry.at[1] - entry.size[1] / 2)
    const shown = Math.max(0, clippedW) * Math.max(0, clippedH) / (entry.size[0] * entry.size[1] || 1)
    if (shown < 0.999) entry.cut = round(shown * 100)
  }

  // The other computable pair questions: how far apart two named things are,
  // where each sits on screen relative to the other, and whether either is
  // facing the other — every one a relation vision models measurably get
  // wrong, and every one arithmetic.
  let between = null
  if (Array.isArray(options.between) && options.between.length === 2) {
    const [first, second] = options.between.map(id => context.world.byId(id))
    if (first && second) {
      const pointA = projector.place(first.x, first.y, first.z || 0)
      const pointB = projector.place(second.x, second.y, second.z || 0)
      between = {
        ids: options.between,
        distance: round(Math.hypot(first.x - second.x, first.y - second.y, (first.z || 0) - (second.z || 0))),
        touching: boxesTouch(
          { x: first.x, y: first.y, z: first.z || 0, ...boundsOf(first) },
          { x: second.x, y: second.y, z: second.z || 0, ...boundsOf(second) }),
        onScreen: `${options.between[0]} is `
          + `${pointA.x < pointB.x ? 'left of' : 'right of'} and `
          + `${pointA.y < pointB.y ? 'above' : 'below'} ${options.between[1]}`
          + `, ${round(Math.hypot(pointA.x - pointB.x, pointA.y - pointB.y))}% apart`,
        facing: {
          [options.between[0]]: facingOffset(first, second),
          [options.between[1]]: facingOffset(second, first)
        }
      }
    } else between = { ids: options.between, error: 'one of the two ids does not exist' }
  }

  // Every other field is a projection, so a fault in world space cannot be seen
  // in them, and `depth` — distance from the lens — reads as height to anyone
  // looking for one. A span per TYPE costs ten lines rather than one per
  // entity, and a gap between two spans is what a structural fault looks like.
  const verticalSpan = {}
  for (const entry of visible) {
    const world = entry._world
    const bottom = world.y - world.h / 2
    const top = world.y + world.h / 2
    const span = verticalSpan[entry.type]
    if (!span) verticalSpan[entry.type] = [round(bottom), round(top)]
    else {
      span[0] = Math.min(span[0], round(bottom))
      span[1] = Math.max(span[1], round(top))
    }
  }

  for (const entry of visible) delete entry._world

  // A whole editor scene lists hundreds of props nobody asked about. Brief
  // keeps the marked entities — the ones a question names — and the totals.
  const listed = options.brief ? visible.filter(entry => entry.mark) : visible

  return {
    ...(options.brief ? { brief: true, listedOnlyMarked: true } : {}),
    camera: {
      mode: projector.mode, x: round(view.x), y: round(view.y), z: round(view.z || 0),
      yaw: round(view.yaw || 0), pitch: round(view.pitch || 0),
      ...(projector.mode === 'ortho' ? { zoom: view.zoom } : { fov: view.fov || 90 })
    },
    viewport: { ...context.viewport },
    visible: listed,
    counts: {
      visible: visible.length,
      offscreen: Object.values(offscreenByType).reduce((sum, n) => sum + n, 0),
      offscreenByType
    },
    /** Percent of the screen each type's boxes cover, before overlap. */
    coverage,
    /**
     * Bottom and top face of each visible type in WORLD units, y up. The only
     * field here that is not a projection, and the one that answers whether a
     * thing rests on, floats above or sinks into another.
     */
    verticalSpan,
    /** One colour per marked type — the colour each See drawing uses for it. */
    palette,
    /**
     * What the author wrote each marked type IS. Authored, not measured. One
     * entry per TYPE, so ten times the rats costs nothing extra. `about: false`
     * drops the block whole.
     */
    ...(options.about === false ? {} : aboutTypes(context, markedTypes)),
    /** Marked pairs whose world boxes interpenetrate — computed, not seen. */
    overlaps,
    /** [nearer, farther] marked pairs whose screen boxes cross — who hides whom. */
    occlusions,
    /** Counts by type in a 3x3 screen grid, named in words. */
    regions,
    ...(between ? { between } : {})
  }
}

/**
 * What the author wrote each of these types IS, and which of them nobody has
 * written yet.
 *
 * One entry per TYPE, never per entity: identity does not vary within a type,
 * so repeating it on forty marked bodies would buy nothing and cost the frame.
 * `undescribed` is emitted because a legend naming four of five marked types
 * reads as "the fifth has nothing worth saying", which is the same false
 * confidence the legend exists to kill. It is left out when empty.
 *
 * `appearance` and `looksWrongWhen` are never here. A vision model adopts a
 * judgement it is handed, so telling a reader what a correct rat looks like
 * answers the one question the picture was taken to ask.
 */
export function aboutTypes(context, typeNames) {
  const about = {}
  const undescribed = []
  for (const type of [...new Set(typeNames)].sort()) {
    const written = context.world.types.get(type)?.about
    if (written) about[type] = written
    else undescribed.push(type)
  }
  return { about, ...(undescribed.length ? { undescribed } : {}) }
}

const round = n => Math.round(n * 100) / 100

/** Nearest first, and the id settles a tie, so one world answers one order. */
const byDepthThenId = (a, b) => a.depth - b.depth || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
