import { boundsOf, facingOffset, boxesTouch } from './frame-facts.js'
import { projectedShape } from './screen-area.js'
import { screenMap } from './projection-map.js'
const round = value => Math.round(value * 100) / 100
const round4 = value => Math.round(value * 10000) / 10000
const screenWidth = hull => Math.max(...hull.map(point => point[0])) - Math.min(...hull.map(point => point[0]))
const screenHeight = hull => Math.max(...hull.map(point => point[1])) - Math.min(...hull.map(point => point[1]))

/** Area in percent-squared below which an on-screen sliver is not listed. */
const PRESENT_AREA = 0.01

/**
 * One entry per entity whose projected shape falls inside the frame, with the
 * projected hull, the share of the hull on screen, and the hull's clipped area.
 * Coverage and cut read those numbers, so both come from the drawn shape rather
 * than from an axis-aligned rectangle a tilted or edge-straddling box defeats.
 *
 * The eight corner projections are the whole pass: the hull, the screen
 * position and the depth all come from them, so no entity is projected twice.
 */
export function projectEntities(context, options, subject, view, projector) {
  const visible = []
  const offscreenByType = {}
  const population = {}
  const entities = context.world.entities || []
  // One camera serves every entity, so its affine pieces are read once and
  // every corner after that is arithmetic on the map rather than a call.
  const screen = screenMap(projector, view, entities) || projector
  for (const entity of entities) {
    if (entity.hidden && !options.includeHidden) continue
    if (subject && options.alone && entity.id !== subject.id) continue
    population[entity.type] = (population[entity.type] || 0) + 1
    const bounds = boundsOf(entity)
    const shape = projectedShape({ x: entity.x, y: entity.y, z: entity.z || 0, ...bounds }, screen)
    if (!shape || shape.clipped <= PRESENT_AREA) {
      offscreenByType[entity.type] = (offscreenByType[entity.type] || 0) + 1
      continue
    }
    visible.push({
      id: entity.id, type: entity.type,
      at: [round(shape.at[0]), round(shape.at[1])],
      size: [round(screenWidth(shape.hull)), round(screenHeight(shape.hull))],
      depth: round(shape.depth),
      _share: shape.share,
      _coverage: shape.clipped / 100,
      _hull: shape.hull,
      _world: { x: entity.x, y: entity.y, z: entity.z || 0, ...bounds }
    })
  }
  return { visible, offscreenByType, population }
}

/** Per type, the screen area its entities cover, as a percent of the frame. */
export function screenCoverage(visible) {
  const coverage = {}
  for (const entry of visible) {
    coverage[entry.type] = (coverage[entry.type] || 0) + entry._coverage
  }
  for (const type of Object.keys(coverage)) coverage[type] = round4(coverage[type])
  return coverage
}

export function markedRelations(marked) {
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
  return { overlaps, occlusions }
}

export function screenRegions(visible) {
  const regions = {}
  for (const entry of visible) {
    const column = entry.at[0] < 33.3 ? 'left' : entry.at[0] < 66.6 ? 'centre' : 'right'
    const row = entry.at[1] < 33.3 ? 'top' : entry.at[1] < 66.6 ? 'middle' : 'bottom'
    const cell = row === 'middle' && column === 'centre' ? 'centre' : `${row}-${column}`
    regions[cell] = regions[cell] || {}
    regions[cell][entry.type] = (regions[cell][entry.type] || 0) + 1
  }
  return regions
}

export function describeBetween(context, options, projector) {
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
  return between
}

export function worldSpans(context, options) {
  const verticalSpan = {}
  for (const entity of context.world.entities) {
    if (entity.hidden && !options.includeHidden) continue
    const bounds = boundsOf(entity)
    const span = verticalSpan[entity.type]
    const bottom = round(entity.y - bounds.h / 2)
    const top = round(entity.y + bounds.h / 2)
    if (!span) verticalSpan[entity.type] = [bottom, top]
    else {
      span[0] = Math.min(span[0], bottom)
      span[1] = Math.max(span[1], top)
    }
  }
  return verticalSpan
}

export function emptyBands(verticalSpan) {
  const spans = Object.entries(verticalSpan)
    .map(([type, [bottom, top]]) => ({ type, bottom, top }))
    .sort((first, second) => first.bottom - second.bottom)
  const bands = []
  for (let index = 1; index < spans.length; index++) {
    const ceiling = Math.max(...spans.slice(0, index).map(span => span.top))
    const metres = round(spans[index].bottom - ceiling)
    if (metres < 1) continue
    bands.push({
      from: ceiling, to: spans[index].bottom, metres, above: spans[index].type,
      why: `nothing occupies these heights, so ${spans[index].type} was placed against a different surface from everything below it. Check this before anything else in the reply.`
    })
  }
  return bands.sort((first, second) => second.metres - first.metres).slice(0, 3)
}

const SIZE_NORM_MAJORITY = 0.5
const SIZE_FAULT_FACTOR = 3

export function findSizeOutliers(context, options) {
  const byType = {}
  for (const entity of context.world.entities) {
    if (entity.hidden && !options.includeHidden) continue
    const bounds = boundsOf(entity)
    const key = [bounds.w, bounds.h, bounds.l].map(round).join('x')
    const list = byType[entity.type] || (byType[entity.type] = [])
    list.push({ entity, bounds, key })
  }

  const found = []
  for (const list of Object.values(byType)) {
    if (list.length < 3) continue
    const counts = {}
    for (const item of list) counts[item.key] = (counts[item.key] || 0) + 1
    const [normKey, normCount] = Object.entries(counts).sort((first, second) => second[1] - first[1])[0]
    if (normCount / list.length <= SIZE_NORM_MAJORITY) continue
    const norm = list.find(item => item.key === normKey).bounds
    const normLargest = Math.max(norm.w, norm.h, norm.l) || 1
    for (const item of list) {
      if (item.key === normKey) continue
      const largest = Math.max(item.bounds.w, item.bounds.h, item.bounds.l)
      const factor = round(Math.max(largest / normLargest, normLargest / largest))
      if (factor < SIZE_FAULT_FACTOR) continue
      found.push({
        id: item.entity.id, type: item.entity.type,
        worldSize: [round(item.bounds.w), round(item.bounds.h), round(item.bounds.l)],
        typicalSize: [round(norm.w), round(norm.h), round(norm.l)],
        factor,
        why: `${item.entity.id}, type ${item.entity.type}, is sized ${factor}x every other ${item.entity.type} in the level — its own box is wrong, not its kind's shape.`
      })
    }
  }
  return found.sort((first, second) => second.factor - first.factor)
}

function hasGeometry(entity) {
  return Boolean(entity.mesh || entity._definition?.mesh || entity.sprite || entity._definition?.sprite)
}

export function findStackedEntities(context, options) {
  const groups = {}
  for (const entity of context.world.entities) {
    if (entity.hidden && !options.includeHidden) continue
    if (!hasGeometry(entity)) continue
    const key = [entity.x, entity.y, entity.z || 0].map(round).join(',')
    const list = groups[key] || (groups[key] = [])
    list.push(entity)
  }

  const found = []
  for (const [key, entities] of Object.entries(groups)) {
    if (entities.length < 2) continue
    const at = key.split(',').map(Number)
    const ids = entities.map(entity => entity.id)
    found.push({
      ids, types: [...new Set(entities.map(entity => entity.type))], at,
      why: `${ids.join(', ')} sit at the exact same world position — only the frontmost is ever visible, so the rest are wasted or misplaced.`
    })
  }
  return found
}
