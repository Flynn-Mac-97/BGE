/**
 * Proof that scene-query answers from fixtures alone: rays hit boxes at exact
 * distances, an occlusion grid counts blocked rays per blocker, point-in-box
 * finds what contains the camera, predicates filter describe entries, and two
 * moments diff into appeared/gone/moved/entered/left.
 *
 * A scratch file in agent-runs, not a test in the project.
 *
 *   node agent-runs/see-query-proof.mjs
 */
import { rayBox, occlusionGrid, insideOf, matches, diffMoments } from '../engine/scene-query.js'

const results = []
const check = (what, ok, detail = '') => {
  results.push({ what, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`)
}
const near = (a, b) => Math.abs(a - b) < 1e-9

// ----------------------------------------------------------------- rayBox
const unitBox = { x: 0, y: 0, z: 0, w: 2, h: 2, l: 2 }
check('a straight ray hits the near face', near(rayBox({ x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: -1 }, unitBox), 9))
check('direction length does not change the distance',
  near(rayBox({ x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: -5 }, unitBox), 9))
check('a diagonal ray hits at the exact distance',
  near(rayBox({ x: 3, y: 4, z: 0 }, { x: -3, y: -4, z: 0 }, unitBox), 3.75))
check('a box behind the ray is null', rayBox({ x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: 1 }, unitBox) === null)
check('a parallel ray outside the slab is null',
  rayBox({ x: 5, y: 0, z: 10 }, { x: 0, y: 0, z: -1 }, unitBox) === null)
check('from inside, the exit wall is the hit', near(rayBox({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, unitBox), 1))
check('a zero direction is null', rayBox({ x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: 0 }, unitBox) === null)

// ---------------------------------------------------------- occlusionGrid
const eye = { x: 0, y: 1, z: 10 }
const target = { id: 'target', type: 'crate', x: 0, y: 1, z: 0, mesh: { box: [2, 2, 2] } }
// Spans x up to -0.5 just in front of the target face: of the 5 sample
// columns at x -0.8 -0.4 0 0.4 0.8, only the -0.8 column projects past -0.5
// at the wall, so exactly one column of five is blocked.
const wallLeft = { id: 'wall-left', type: 'wall', x: -5.5, y: 1, z: 1.5, mesh: { box: [10, 10, 0.2] } }
const wallBig = { id: 'wall-big', type: 'wall', x: 0, y: 1, z: 5, mesh: { box: [40, 40, 0.5] } }

const clear = occlusionGrid(eye, target, [target])
check('nothing between means fully visible', clear.visibleFraction === 1 && clear.blockedBy.length === 0)
check('a 5x5 grid casts 25 rays', clear.rays.length === 25)

const partly = occlusionGrid(eye, target, [wallLeft, target])
check('a wall over one column blocks 5 of 25 rays',
  near(partly.visibleFraction, 0.8), `visibleFraction ${partly.visibleFraction}`)
check('the wall is named with its ray count',
  partly.blockedBy.length === 1 && partly.blockedBy[0].id === 'wall-left' && partly.blockedBy[0].rays === 5)
check('each blocked ray names its blocker and distance',
  partly.rays.filter(ray => ray.hit === 'wall-left' && ray.distance > 0).length === 5)

const covered = occlusionGrid(eye, target, [wallLeft, wallBig])
check('a covering wall blocks everything', covered.visibleFraction === 0)
check('the first hit wins: the nearer wall takes all 25 rays',
  covered.blockedBy.length === 1 && covered.blockedBy[0].id === 'wall-big' && covered.blockedBy[0].rays === 25)

const wide = occlusionGrid(eye, target, [wallLeft], 5, 10)
check('more columns resolve the same wall more finely',
  near(wide.visibleFraction, 0.8), `visibleFraction ${wide.visibleFraction}`)

// --------------------------------------------------------------- insideOf
const player = { id: 'player', type: 'kitten', x: 0, y: 1, z: 0, mesh: { box: [1, 2, 1] } }
const crate = { id: 'crate-1', type: 'crate', x: 3, y: 1, z: 0, mesh: { box: [2, 2, 2] } }
const world = [player, crate]
const inPlayer = insideOf({ x: 0.2, y: 1.5, z: 0.1 }, world)
check('a camera inside the player finds the player', inPlayer.length === 1 && inPlayer[0].id === 'player')
check('a point in open space is inside nothing', insideOf({ x: 10, y: 0, z: 0 }, world).length === 0)
check('a box boundary is inclusive', insideOf({ x: 0.5, y: 1, z: 0 }, world).some(e => e.id === 'player'))
check('a swapped bounds function is used',
  insideOf({ x: 1.5, y: 1, z: 0 }, world, () => ({ w: 20, h: 20, l: 20 })).length === 2)

// ---------------------------------------------------------------- matches
const entry = {
  id: 'boar-3', type: 'boar', at: [70, 20], size: [10, 8], depth: 12,
  cut: 40, occluded: 0.6, world: { x: 3, y: 0, z: -4 }
}
check('type matches', matches(entry, { type: 'boar' }) && !matches(entry, { type: 'rat' }))
check('idPrefix matches', matches(entry, { idPrefix: 'boar' }) && !matches(entry, { idPrefix: 'rat' }))
check('occludedOver and Under read the attached fraction',
  matches(entry, { occludedOver: 0.5 }) && !matches(entry, { occludedUnder: 0.5 }))
check('an absent occluded reads as zero', matches({ ...entry, occluded: undefined }, { occludedUnder: 0.1 }))
check('cutUnder reads the shown percent', matches(entry, { cutUnder: 50 }) && !matches(entry, { cutUnder: 30 }))
check('an absent cut reads as fully shown', !matches({ ...entry, cut: undefined }, { cutUnder: 99 }))
check('sizeOver and Under read the larger dimension',
  matches(entry, { sizeOver: 9 }) && matches(entry, { sizeUnder: 11 }) && !matches(entry, { sizeOver: 10 }))
check('depthOver and Under', matches(entry, { depthOver: 10 }) && !matches(entry, { depthUnder: 12 }))
check('region names the describe cell',
  matches(entry, { region: 'top-right' }) && matches({ ...entry, at: [50, 50] }, { region: 'centre' }))
check('within a world point', matches(entry, { within: [5, { x: 0, y: 0, z: 0 }] })
  && !matches(entry, { within: [4.9, { x: 0, y: 0, z: 0 }] }))
check('within another entity', matches(entry, { within: [1, { x: 3, y: 0, z: -3 }] }))
check('every predicate must hold',
  matches(entry, { type: 'boar', depthOver: 10 }) && !matches(entry, { type: 'boar', depthOver: 20 }))
let threw = null
try { matches({ id: 'a', type: 'a', at: [0, 0], size: [1, 1], depth: 1 }, { within: [5, { x: 0, y: 0 }] }) }
catch (error) { threw = error.message }
check('within without a world position throws, not false', /world position/.test(threw || ''), threw)
threw = null
try { matches(entry, { sizeBelow: 5 }) } catch (error) { threw = error.message }
check('an unknown predicate throws', /unknown predicate/.test(threw || ''), threw)

// ------------------------------------------------------------ diffMoments
const before = {
  visible: [
    { id: 'rat-1', type: 'rat', at: [10, 10], size: [5, 5], depth: 5 },
    { id: 'rat-2', type: 'rat', at: [20, 20], size: [5, 5], depth: 6 },
    { id: 'boar-1', type: 'boar', at: [50, 50], size: [8, 8], depth: 8 },
    { id: 'crate-still', type: 'crate', at: [90, 90], size: [4, 4], depth: 9 }
  ],
  counts: { visible: 4, offscreen: 1, offscreenByType: { rat: 1 } }
}
const after = {
  visible: [
    { id: 'rat-1', type: 'rat', at: [30, 10], size: [5, 5], depth: 5 },
    { id: 'rat-3', type: 'rat', at: [80, 80], size: [5, 5], depth: 9 },
    { id: 'crate-new', type: 'crate', at: [40, 40], size: [4, 4], depth: 7 },
    { id: 'crate-still', type: 'crate', at: [90.2, 90], size: [4, 4], depth: 9 }
  ],
  counts: { visible: 4, offscreen: 1, offscreenByType: { rat: 0, boar: 1 } }
}
const diff = diffMoments(before, after)
check('a new id with no offscreen drop appeared', diff.appeared.join() === 'crate-new', diff.appeared.join())
check('a new id covered by an offscreen drop entered the frame',
  diff.enteredFrame.join() === 'rat-3', diff.enteredFrame.join())
check('a lost id with no offscreen rise is gone', diff.gone.join() === 'rat-2', diff.gone.join())
check('a lost id covered by an offscreen rise left the frame',
  diff.leftFrame.join() === 'boar-1', diff.leftFrame.join())
check('a real move reports its screen and depth deltas',
  diff.moved.length === 1 && diff.moved[0].id === 'rat-1' && diff.moved[0].by.join() === '20,0,0',
  JSON.stringify(diff.moved))
check('a sub-threshold wobble is not a move', !diff.moved.some(m => m.id === 'crate-still'))
const same = diffMoments(before, before)
check('a moment diffed with itself is all empty',
  !same.appeared.length && !same.gone.length && !same.moved.length
  && !same.enteredFrame.length && !same.leftFrame.length)

const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
