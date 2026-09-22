/**
 * plugins/builtin/see/scene-query.js `occlusionGrid`: the blocked fraction is shadow area,
 * not where sample rays happen to land.
 *
 * The query used to sample a fixed rows x columns grid, so a blocker narrower
 * than a cell fell between samples and was missed. It now projects every
 * blocker box to a convex shadow on the eye-facing face and takes the union of
 * those areas. These cases pin that: thin blockers counted, overlapping shadows
 * unioned rather than summed, the reported fraction consistent with the rays it
 * delivered, and a blocker behind the subject ignored.
 *
 * Pure: entities and numbers in, numbers out. No world, no renderer, no clock.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { rayBox, occlusionGrid } from '../plugins/builtin/see/scene-query.js'
import { boundsOf } from '../plugins/builtin/see/frame-facts.js'

/** A 2x2x2 subject at the origin; the eye on +Z sees its z = +1 face, x,y in [-1,1]. */
const HERO = () => ({ id: 'hero', x: 0, y: 0, z: 0, mesh: { box: [2, 2, 2] } })
const EYE = { x: 0, y: 0, z: 8 }

/** A blocker box of width x height x depth in world units, centred on x/y/z. */
const box = (id, x, y, z, w, h, l) => ({ id, x, y, z, mesh: { box: [w, h, l] } })

/** A blocker wide and tall enough to cover the whole face at the depth it stands. */
const slab = (id, x, z, width = 40, height = 40) => box(id, x, 0, z, width, height, 0.2)

/** The fraction the delivered rays themselves counted. */
const rayRatio = answer => {
  const hits = answer.rays.filter(ray => ray.hit != null).length
  return (answer.rays.length - hits) / answer.rays.length
}

/** The ids the answer says block part of the face. */
const named = answer => new Set(answer.blockedBy.map(entry => entry.id))

/**
 * The visible fraction by dense sampling of the eye-facing face, each ray tested
 * with `rayBox`. Independent of the kernel's shadow-area math; only the choice
 * of face is shared, because the kernel samples that face and no other.
 */
function denseVisibleFraction(eye, subject, others, size = 240) {
  const bounds = boundsOf(subject)
  const centre = { x: subject.x, y: subject.y, z: subject.z || 0 }
  const half = { x: bounds.w / 2, y: bounds.h / 2, z: (bounds.l || 0) / 2 }
  const offset = { x: eye.x - centre.x, y: eye.y - centre.y, z: (eye.z || 0) - centre.z }
  const facing = ['x', 'y', 'z'].reduce((best, axis) => Math.abs(offset[axis]) > Math.abs(offset[best]) ? axis : best)
  const side = Math.sign(offset[facing]) || 1
  const [runs, rises] = facing === 'x' ? ['z', 'y'] : facing === 'y' ? ['x', 'z'] : ['x', 'y']
  const boxes = others.map(entity => ({ x: entity.x, y: entity.y, z: entity.z || 0, ...boundsOf(entity) }))
  let visible = 0
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      const point = { ...centre }
      point[facing] += side * half[facing]
      point[runs] += ((column + 0.5) / size * 2 - 1) * half[runs]
      point[rises] += ((row + 0.5) / size * 2 - 1) * half[rises]
      const direction = { x: point.x - eye.x, y: point.y - eye.y, z: point.z - eye.z }
      const span = Math.hypot(direction.x, direction.y, direction.z)
      const blocked = boxes.some(box => {
        const distance = rayBox(eye, direction, box)
        return distance !== null && distance < span - 1e-6
      })
      if (!blocked) visible++
    }
  }
  return visible / (size * size)
}

test('an empty scene sees the whole face', () => {
  const answer = occlusionGrid(EYE, HERO(), [], 8, 8)
  assert.ok(Math.abs(answer.visibleFraction - 1) < 1e-9, `expected no occlusion, got ${answer.visibleFraction}`)
  assert.deepEqual(answer.blockedBy, [])
  assert.ok(answer.rays.every(ray => ray.hit === null), 'a ray named a hit with nothing in the scene')
})

test('a post narrower than a coarse grid cell is still counted', () => {
  // 0.1 wide against a 2-wide face; whether a 6x6 sample grid lands on it is
  // luck, and the shadow is what decides it now.
  const answer = occlusionGrid(EYE, HERO(), [box('post', 0.1, 0, 4, 0.1, 40, 0.2)], 6, 6)
  assert.ok(named(answer).has('post'), 'the thin post is not named as a blocker')
  assert.ok(answer.visibleFraction < 0.95, `the thin post blocked nothing: ${answer.visibleFraction}`)
  assert.ok(answer.visibleFraction > 0.8, `the thin post blocked far too much: ${answer.visibleFraction}`)
})

test('the reported fraction is the one the delivered rays counted', () => {
  const scenes = [
    [slab('half', -10, 4, 20)],
    [box('post', 0.1, 0, 4, 0.1, 40, 0.2)],
    [slab('cover', 0, 5)],
    [box('left', 0.1, 0, 4, 0.2, 40, 0.2), box('right', 0.2, 0, 4, 0.2, 40, 0.2)]
  ]
  for (const others of scenes) {
    const answer = occlusionGrid(EYE, HERO(), others, 12, 12)
    assert.ok(Math.abs(answer.visibleFraction - rayRatio(answer)) <= 1e-6,
      `fraction ${answer.visibleFraction} disagrees with the ray ratio ${rayRatio(answer)}`)
  }
})

test('overlapping shadows union rather than sum', () => {
  const left = occlusionGrid(EYE, HERO(), [post('left', 0.1)], 24, 24)
  const right = occlusionGrid(EYE, HERO(), [post('right', 0.2)], 24, 24)
  const both = occlusionGrid(EYE, HERO(), [post('left', 0.1), post('right', 0.2)], 24, 24)

  const blocked = answer => 1 - answer.visibleFraction
  assert.ok(blocked(both) < blocked(left) + blocked(right) - 0.02,
    `overlap was summed, not unioned: ${blocked(both)} against ${blocked(left) + blocked(right)}`)
  assert.ok(blocked(both) > blocked(left), 'the second blocker added no occlusion')
  assert.deepEqual([...named(both)].sort(), ['left', 'right'])
})

test('a blocker behind the subject blocks nothing at any depth', () => {
  const answer = occlusionGrid(EYE, HERO(), [box('behind', 0, 0, -3, 3, 3, 0.2), box('farther', 0, 0, -7, 4, 4, 0.2)], 10, 10)
  assert.ok(Math.abs(answer.visibleFraction - 1) < 1e-9, `a blocker behind the subject occluded it: ${answer.visibleFraction}`)
  assert.deepEqual(answer.blockedBy, [])
})

test('a cover over the whole face reads zero and names the cover', () => {
  const answer = occlusionGrid(EYE, HERO(), [slab('cover', 0, 5)], 10, 10)
  assert.ok(answer.visibleFraction <= 1e-9, `a full cover left ${answer.visibleFraction} visible`)
  assert.deepEqual([...named(answer)], ['cover'])
})

test('a near cover hides a farther post, and only the near cover is named', () => {
  const answer = occlusionGrid(EYE, HERO(), [slab('near', 0, 6), box('far-post', 0, 0, 3, 1, 1, 0.2)], 16, 16)
  assert.ok(answer.visibleFraction <= 1e-9, `the near cover left ${answer.visibleFraction} visible`)
  assert.deepEqual([...named(answer)], ['near'], 'a blocker that takes no visible area was named')
})

test('a blocker whose shadow misses the face is not named and changes nothing', () => {
  const answer = occlusionGrid(EYE, HERO(), [box('far-away', 50, 0, 4, 0.2, 40, 0.2)], 10, 10)
  assert.ok(Math.abs(answer.visibleFraction - 1) < 1e-9, `a shadow off the face occluded it: ${answer.visibleFraction}`)
  assert.deepEqual(answer.blockedBy, [])
})

test('a near blocker inside a farther shadow is named, not hidden by it', () => {
  // The eye at z 24 looks toward -Z, so the post at z 12 is NEARER than the
  // wall at z 6, and its shadow falls wholly inside the wall's.
  const eye = { x: 0, y: 0, z: 24 }
  const wall = slab('wall', 0, 6)
  const post = box('post', 0, 0, 12, 0.4, 0.4, 0.4)
  const answer = occlusionGrid(eye, HERO(), [post, wall], 8, 8)

  assert.deepEqual([...named(answer)].sort(), ['post', 'wall'], 'the nearest blocker was dropped')
  assert.ok(answer.visibleFraction <= 1e-9, `a full wall left ${answer.visibleFraction} visible`)
})

test('a complex scene matches a dense independent sample, and unions rather than sums', () => {
  const eye = { x: 4, y: 2, z: 24 }
  const subject = box('hull', 0, 0, 0, 5, 5, 5)
  const others = [
    box('far-wall', 0.65, 0, 6, 1.8, 6, 0.3),
    box('mid-wall', 1.21, 0, 9, 1.6, 6, 0.3),
    box('thin-post', 2.42, 0, 7, 0.1, 6, 0.1),
    box('near-post', 1.77, 0, 12, 0.3, 2, 0.3),
    box('behind', 0, 0, -3, 3, 3, 3)
  ]

  const answer = occlusionGrid(eye, subject, others, 6, 6)
  const dense = denseVisibleFraction(eye, subject, others)
  assert.ok(Math.abs(answer.visibleFraction - dense) < 0.015,
    `analytic ${answer.visibleFraction} against dense ${dense}`)

  // Five overlapping shadows: the union is far smaller than the sum of the parts.
  const sumBlocked = others.reduce((total, one) => total + (1 - occlusionGrid(eye, subject, [one], 6, 6).visibleFraction), 0)
  assert.ok(1 - answer.visibleFraction < sumBlocked - 0.2,
    `overlapping shadows were summed: union ${1 - answer.visibleFraction} against parts ${sumBlocked}`)

  // Nearest attribution, both directions.
  const names = named(answer)
  assert.ok(names.has('near-post'), 'a near blocker inside a farther shadow was dropped')
  assert.ok(names.has('thin-post'), 'the thin post was dropped')
  assert.ok(names.has('mid-wall'), 'the wall that covers the far wall was dropped')
  assert.ok(!names.has('far-wall'), 'a blocker fully covered by a nearer one was named')
  assert.ok(!names.has('behind'), 'a blocker behind the subject was named')
})

test('a blocker with its edge on the centre line cuts the face exactly in half', () => {
  // The box spans x in [-20, 0]; that edge sits on the eye's x, so it projects
  // to x = 0 at every depth. Half the face, whatever the ray count.
  const answer = occlusionGrid(EYE, HERO(), [slab('left-half', -10, 4, 20)], 8, 8)
  assert.ok(Math.abs(answer.visibleFraction - 0.5) < 1e-6, `expected 0.5, got ${answer.visibleFraction}`)
})

test('blockedBy counts add up to the rays that hit', () => {
  const answer = occlusionGrid(EYE, HERO(), [box('left', 0.1, 0, 4, 0.2, 40, 0.2), box('right', 0.35, 0, 4, 0.2, 40, 0.2)], 20, 20)
  const hits = answer.rays.filter(ray => ray.hit != null).length
  const counted = answer.blockedBy.reduce((total, entry) => total + entry.rays, 0)
  assert.equal(counted, hits)
})

test('every delivered ray samples a point on the eye-facing face', () => {
  const answer = occlusionGrid(EYE, HERO(), [box('post', 0.1, 0, 4, 0.1, 40, 0.2)], 12, 12)
  for (const ray of answer.rays) {
    assert.ok(Math.abs(ray.to[0]) <= 1 + 1e-9, `x ${ray.to[0]} is off the subject`)
    assert.ok(Math.abs(ray.to[1]) <= 1 + 1e-9, `y ${ray.to[1]} is off the subject`)
    assert.ok(Math.abs(ray.to[2] - 1) <= 1e-9, `z ${ray.to[2]} is not the eye-facing face`)
  }
})

/** One 0.2-wide post at z = 4, as a blocker an answer can be built from. */
function post(id, centreX) {
  return box(id, centreX, 0, 4, 0.2, 40, 0.2)
}
