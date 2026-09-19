/**
 * see screen area: the on-screen share of an entity is its projected hull
 * clipped to the frame, not its axis-aligned screen rectangle.
 *
 * These are independent scenes, deliberately not the ones the Dream run that
 * wrote `screen-area.js` and `projection-map.js` was tuned on. The reference is
 * computed here from the engine projector's own `place`: project the eight box
 * corners, take their hull, clip it to the frame, and measure with the shoelace
 * formula. That is a different implementation from the one under test, and it
 * uses `place` directly rather than the fitted map the code adds.
 *
 * Pure: entities, cameras and numbers. No world, no renderer, no clock.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { makeProjector } from '../engine/camera-project.js'
import { boundsOf, convexHull } from '../engine/frame-facts.js'
import { projectedShape, clipToFrame, polygonArea } from '../plugins/builtin/see/screen-area.js'
import { projectEntities, screenCoverage } from '../plugins/builtin/see/describe-facts.js'
import { addClipping } from '../plugins/builtin/see/describe-marks.js'
import { screenMap } from '../plugins/builtin/see/projection-map.js'

const VIEWPORT = { width: 1280, height: 720 }

// Deliberately not the run's cameras: a small yaw and tilt so the frame answers
// cannot be read off the scenes the kernel was tuned on.
const EDGE_CAMERA = { mode: 'perspective', x: 0.6, y: 0.8, z: 21, yaw: 0.05, pitch: -0.04, fov: 58 }
const PAIR_CAMERA = { mode: 'perspective', x: -1.4, y: 0.9, z: 23, yaw: -0.07, pitch: 0.06, fov: 53 }

/** A box entity: width, height and depth in world units, centred on x/y/z. */
const box = (id, type, x, y, z, w, h, l) => ({ id, type, x, y, z, mesh: { box: [w, h, l] } })

/** What `projectEntities` needs from a context. */
const contextOf = entities => ({ world: { entities } })

const round = value => Math.round(value * 100) / 100

/**
 * The reference: the projected hull of one box, clipped to the frame.
 *
 * Independent of `screen-area.js` — it projects with the engine projector and
 * does its own hull and clip. `at` is the mean of the eight corner projections,
 * which is what the kernel stores as screen position.
 */
function reference(entity, camera) {
  const projector = makeProjector(camera, VIEWPORT)
  const bounds = boundsOf(entity)
  const corners = []
  let sumX = 0, sumY = 0
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const point = projector.place(
      entity.x + sx * bounds.w / 2,
      entity.y + sy * bounds.h / 2,
      (entity.z || 0) + sz * (bounds.l || 0) / 2)
    if (!point.inFront || (projector.mode !== 'ortho' && point.depth < 0.2)) return null
    corners.push([point.x, point.y])
    sumX += point.x
    sumY += point.y
  }
  const hull = convexHull(corners)
  if (hull.length < 3) return null
  const full = polygonArea(hull)
  const clipped = polygonArea(clipToFrame(hull))
  return {
    full,
    clipped,
    share: full > 0 ? clipped / full : 0,
    at: [sumX / corners.length, sumY / corners.length]
  }
}

/** The axis-aligned screen rectangle's area, which the hull replaces. */
function rectangleArea(hull) {
  const xs = hull.map(point => point[0])
  const ys = hull.map(point => point[1])
  return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys))
}

/** Run the describe projection for one scene and give back the visible entries. */
function describeScene(entities, camera) {
  const projector = makeProjector(camera, VIEWPORT)
  return projectEntities(contextOf(entities), {}, null, camera, projector)
}

// --------------------------------------------------------------- projection map

test('the fitted projection reproduces the projector it was read from', () => {
  const entities = [box('one', 'crate', 1, 2, 0, 3, 4, 2), box('two', 'post', -3, 1, 2, 2, 6, 2)]
  const camera = { mode: 'perspective', x: 5, y: 3, z: 22, yaw: 0.3, pitch: -0.2, fov: 47 }
  const projector = makeProjector(camera, VIEWPORT)
  const map = screenMap(projector, camera, entities)
  assert.ok(map, 'the map refused a camera it should be able to read')

  for (const [x, y, z] of [[0, 0, 0], [1, 2, 3], [-4, 5, -2], [3.3, -1.1, 0.7]]) {
    const truth = projector.place(x, y, z)
    const fitted = map.place(x, y, z)
    assert.ok(Math.abs(fitted.x - truth.x) < 1e-6, `x ${fitted.x} against ${truth.x}`)
    assert.ok(Math.abs(fitted.y - truth.y) < 1e-6, `y ${fitted.y} against ${truth.y}`)
    assert.ok(Math.abs(fitted.depth - truth.depth) < 1e-6, `depth ${fitted.depth} against ${truth.depth}`)
    assert.equal(fitted.inFront, truth.inFront)
  }
})

test('an ortho camera maps without depth', () => {
  const camera = { mode: 'ortho', x: 2, y: -2, zoom: 14 }
  const projector = makeProjector(camera, VIEWPORT)
  const map = screenMap(projector, camera, [])
  assert.ok(map, 'the ortho map was refused')
  const truth = projector.place(6, 3, 1)
  const fitted = map.place(6, 3, 1)
  assert.ok(Math.abs(fitted.x - truth.x) < 1e-6)
  assert.ok(Math.abs(fitted.y - truth.y) < 1e-6)
})

// --------------------------------------------------------------- projected shape

test('the projected shape matches the independent hull reference', () => {
  const camera = { mode: 'perspective', x: -9, y: 6, z: 22, yaw: -0.42, pitch: -0.33, fov: 52 }
  const entity = box('monolith', 'monolith', 0, 2, 0, 3, 8, 4)
  const expected = reference(entity, camera)
  const shape = projectedShape({ x: entity.x, y: entity.y, z: entity.z, ...boundsOf(entity) }, makeProjector(camera, VIEWPORT))

  assert.ok(shape, 'a box in front of the eye produced no shape')
  assert.ok(Math.abs(shape.full - expected.full) < 1e-6, `full ${shape.full} against ${expected.full}`)
  assert.ok(Math.abs(shape.clipped - expected.clipped) < 1e-6, `clipped ${shape.clipped} against ${expected.clipped}`)
  assert.ok(Math.abs(shape.share - expected.share) < 1e-6, `share ${shape.share} against ${expected.share}`)
  assert.ok(Math.abs(shape.at[0] - expected.at[0]) < 1e-6, 'screen x is not the mean of the corner projections')
  assert.ok(Math.abs(shape.at[1] - expected.at[1]) < 1e-6, 'screen y is not the mean of the corner projections')
})

test('a tilted box is measured by its hull, not its screen rectangle', () => {
  const camera = { mode: 'perspective', x: -9, y: 6, z: 22, yaw: -0.42, pitch: -0.33, fov: 52 }
  const entity = box('monolith', 'monolith', 0, 2, 0, 3, 8, 4)
  const shape = projectedShape({ x: entity.x, y: entity.y, z: entity.z, ...boundsOf(entity) }, makeProjector(camera, VIEWPORT))
  const rectangle = rectangleArea(shape.hull)

  assert.ok(Math.abs(rectangle - shape.full) / shape.full > 0.05,
    `the test scene does not separate hull from rectangle: ${shape.full} against ${rectangle}`)
  const answer = screenCoverage(describeScene([entity], camera).visible)
  assert.ok(Math.abs(answer.monolith - shape.clipped / 100) < 1e-4,
    `coverage ${answer.monolith} is not the clipped hull ${shape.clipped / 100}`)
})

// -------------------------------------------------------------- visible listing

test('a box fully on screen reports no cut', () => {
  const camera = { mode: 'perspective', x: 3, y: 4, z: 27, yaw: 0.25, pitch: -0.18, fov: 47 }
  const entity = box('pillar', 'pillar', 0, 0, 0, 4, 4, 4)
  const expected = reference(entity, camera)
  assert.ok(expected.share >= 0.999, `the test box is not wholly on screen: share ${expected.share}`)

  const { visible } = describeScene([entity], camera)
  assert.equal(visible.length, 1, 'a wholly visible box was not listed')
  addClipping(visible)
  assert.equal(visible[0].cut, undefined, 'a wholly visible box reported a cut')
})

test('a box across the frame edge reports the clipped share and counts only the on-screen part', () => {
  const camera = EDGE_CAMERA
  const entity = box('panel', 'panel', 13, 0, 0, 8, 8, 8)
  const expected = reference(entity, camera)
  assert.ok(expected.share > 0.05 && expected.share < 0.95,
    `the test box does not straddle the edge: share ${expected.share}`)

  const { visible } = describeScene([entity], camera)
  assert.equal(visible.length, 1, 'an edge-straddling box was not listed')
  addClipping(visible)
  assert.equal(visible[0].cut, round(expected.share * 100), 'the cut is not the clipped share of the hull')

  const answer = screenCoverage(visible)
  assert.ok(Math.abs(answer.panel - expected.clipped / 100) < 1e-4, 'coverage is not the clipped area')
  assert.ok(answer.panel < expected.full / 100, 'coverage counted the off-screen part of the box')
})

test('an entity behind the eye is offscreen, not a zero-size visible one', () => {
  const camera = EDGE_CAMERA
  const behind = box('ghost', 'ghost', 0, 0, 40, 4, 4, 4)
  const { visible, offscreenByType } = describeScene([behind], camera)
  assert.equal(reference(behind, camera), null, 'the test entity is not behind the eye')
  assert.deepEqual(visible, [], 'an entity behind the eye was listed as visible')
  assert.equal(offscreenByType.ghost, 1)
})

test('two entities of one type add their coverage; two types stay apart', () => {
  const camera = PAIR_CAMERA
  const entities = [
    box('near', 'post', -4, 0, 0, 3, 6, 3),
    box('far', 'post', 5, 0, -2, 3, 6, 3),
    box('crate', 'crate', 0, 0, 2, 4, 4, 4)
  ]
  const { visible } = describeScene(entities, camera)
  const answer = screenCoverage(visible)
  const expected = { post: 0, crate: 0 }
  for (const entity of entities) {
    const shape = reference(entity, camera)
    expected[entity.type] += shape.clipped / 100
  }
  assert.ok(Math.abs(answer.post - expected.post) < 1e-4, `post ${answer.post} against ${expected.post}`)
  assert.ok(Math.abs(answer.crate - expected.crate) < 1e-4, `crate ${answer.crate} against ${expected.crate}`)
})

test('a sliver above the floor is listed; one below it is offscreen', () => {
  const camera = EDGE_CAMERA
  // Both are a fraction of a percent of the frame. The first keeps a clipped
  // area over 0.01 percent-squared and must be listed; the second is under it.
  const shown = box('bead', 'bead', 14.5, 0, 0, 0.5, 0.5, 0.5)
  const gone = box('dust', 'dust', 0, 0, 0, 0.02, 0.02, 0.02)
  const near = reference(shown, camera)
  const far = reference(gone, camera)
  assert.ok(near.clipped > 0.01, `the listed sliver is under the floor: ${near.clipped}`)
  assert.ok(far.clipped > 0 && far.clipped <= 0.01, `the dropped sliver is not under the floor: ${far.clipped}`)

  const { visible, offscreenByType } = describeScene([shown, gone], camera)
  assert.deepEqual(visible.map(entry => entry.id), ['bead'], 'the sliver floor listed the wrong entities')
  assert.equal(offscreenByType.dust, 1)
  assert.ok(screenCoverage(visible).bead > 0, 'the listed sliver contributed no coverage')
})

test('an ortho camera measures coverage the same way', () => {
  const camera = { mode: 'ortho', x: 2, y: -2, zoom: 14 }
  const entity = box('tile', 'tile', 10, 0, 0, 8, 8, 8)
  const expected = reference(entity, camera)
  assert.ok(expected.clipped > 0, 'the test tile is off screen')
  const { visible } = describeScene([entity], camera)
  const answer = screenCoverage(visible)
  assert.ok(Math.abs(answer.tile - expected.clipped / 100) < 1e-4, `ortho coverage ${answer.tile} against ${expected.clipped / 100}`)
})
