#!/usr/bin/env node
/**
 * Build kitten-survivors/levels/meadow.json.
 *
 *   node tools/make-kitten-survivors-meadow.mjs
 *
 * WHY A TOOL AND NOT A HAND-WRITTEN FILE. There is no repeat, no array, no group
 * and no prefab in the level format, so a wall is a dozen literal JSON objects
 * and a landmark is five. Scattering a field by hand is transcription, and a
 * transcribed field comes out in rows because a person cannot invent hundreds of
 * unbiased numbers.
 *
 * The level file this writes is still the truth. It is ordinary placements, the
 * editor can select and drag every one, and nothing at runtime knows this tool
 * exists. Re-running it overwrites whatever the editor last saved. EDIT THIS
 * FILE AND THE LEVEL TOGETHER OR NEITHER — a hand edit to the level is lost
 * silently the next time anyone builds.
 *
 * Everything is seeded from one number, so the same seed gives the same meadow
 * byte for byte and a re-run is a reviewable diff.
 *
 * The direction this builds to is kitten-survivors/art/world/bible.md, generated
 * by the Art Direction plugin. `art.check` tests a frame of this meadow against
 * it.
 *
 * ================================ THE THREE CLASSES ==========================
 *
 * A player has to learn the rules of the space from shape alone, so the arena
 * draws exactly three kinds of thing and each one makes a claim no other makes.
 *
 *   WALL. The boundary, and the only thing that blocks. Tall, hard-edged,
 *   axis-aligned, one shared cold colour, unbroken all the way round, with a
 *   pier rhythm so it reads as built rather than grown. Nothing else in the
 *   level is over 0.5 m and nothing else is cold.
 *
 *   LANDMARK. A place the player can name. Right-angled in PLAN, two to three
 *   metres across, and the largest thing in the field by a factor of three. One
 *   shared warm dark colour. It does not block and it never moves, so a player
 *   learns in one run that a big dark right-angled shape is somewhere to be, not
 *   something to avoid.
 *
 *   DECORATION. Everything else, and it says nothing. Low, small, blobby, and
 *   held in the ground's own hue and value, so it enriches the surface and never
 *   competes for a glance. Capped at DECORATION_CEILING, well under the cat.
 *
 * ================================= THE VALUE BANDS ===========================
 *
 * The floor measures 0.674 and the cat 0.92. The horde is saturated mid value,
 * so the dark end of the picture is free and the arena is the only thing that
 * can supply it — `real-tonal-range` wants a value.spread of 0.27 and a frame of
 * bright ground alone cannot reach it.
 *
 *   STRUCTURE_BAND — wall and landmark. Far below the horde, far below the
 *   floor. This is the frame's dark end and the whole of the figure-from-ground
 *   separation for the two classes that carry meaning.
 *
 *   DECORATION_BAND — decoration, matched to what the floor DRAWS rather than to
 *   what its texture measures. Outside it a clump stops reading as ground and
 *   starts reading as an object, which is the one thing decoration must not do.
 *
 *   FLOOR_BAND — anything lying in the floor, measured from the floor's own
 *   value. A decal carries the floor's own texture, so the two compare directly.
 *
 * All three are CHECKED, not asserted. The tool reads every texture it names,
 * multiplies its mean colour by the tint the placement carries, and fails the
 * build on anything outside its band. It also fails on a prop taller than the
 * ceiling inside the fence, and on any box whose bottom face is under the floor.
 *
 * =============================== WHAT THE CAMERA SEES ========================
 *
 * Every distance here is set from it. At `distance` 9, `pitch` -1.05 and `fov`
 * 55 the eye stands 8.16 m up and 4.5 m behind the cat, and the frame's top ray
 * meets the ground 8.2 m in front of the cat. The horizon is never on screen:
 * every pixel of a play frame is ground, and NOTHING FURTHER THAN ABOUT 12 m
 * FROM THE CAT IS EVER DRAWN. So a boundary is only a boundary if the player can
 * get within eight metres of it, and at 45 m it never was.
 *
 * FIELD IS THE ONE DIAL, and it is set by the run, not by the picture. Every
 * count and every layout below scales off it. Smaller is better for the art —
 * the wall reaches the frame sooner and there is less unseen ground — and worse
 * for the run, because the crowd converges on a cornered player. Measured with
 * `tests.run`:
 *
 *   FIELD 15 and 20   the kitten dies at 0:49 and `wave-arc` fails
 *   FIELD 25 and 30   7 of 7, twice each
 *
 * 25 is the smallest field the run survives. Take it lower only with a change to
 * the wave schedule, which is not this file.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { readImage } from '../plugins/builtin/art-direction/image.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'kitten-survivors/levels/meadow.json')

// --------------------------------------------------------------- the numbers
/** Half the play field, measured to the inside face of the wall. */
const FIELD = 25
/**
 * Half the ground slab.
 *
 * It reaches past everything the level draws. The fog is the sky's own colour,
 * so the ground never ends at an edge — it ends by becoming the sky.
 */
const SLAB = 100
/** Nothing is scattered within this of the origin, so the first frame is clean. */
const SPAWN_CLEAR = 3.2
/** The tallest anything inside the fence is allowed to be. */
const FIELD_CEILING = 0.5
/** The tallest decoration is allowed to be. Ankle height on a 0.45 m cat. */
const DECORATION_CEILING = 0.22

/**
 * The value band the wall and the landmarks sit in, as luminance 0 to 1.
 *
 * THE BAND IS SET BY WHAT ELSE IS ON SCREEN. The floor is 0.674, the cat is
 * 0.92, and the horde holds saturated mid value. Below 0.26 nothing in the level
 * can be mistaken for an enemy, and the gap to the floor is a quarter of the
 * range even after the floor draws darker than it measures — enough that a
 * landmark survives greyscale, which is the test the reference passes and a
 * same-hue prop fails. The bottom is 0.16 rather than lower because ambient is
 * 0.26: a face the key misses draws at about a third of its own value, and below
 * 0.16 an unlit side face comes back black.
 */
const STRUCTURE_BAND = [0.16, 0.28]

/**
 * How far anything lying in the floor may stand from the floor's own value.
 *
 * A tenth. Far enough that a worn patch reads as worn, near enough that the
 * field still reads as one surface. It applies only to decals, which carry the
 * floor's own texture and so can be compared to it directly.
 */
const FLOOR_BAND = 0.1

/**
 * The value band decoration tints sit in, and the one number here that is
 * measured off a frame rather than computed.
 *
 * A FLAT TINT DRAWS ABOUT HALF AGAIN BRIGHTER THAN A TEXTURE OF THE SAME VALUE.
 * The floor's field.png measures 0.674 on disk and a play frame reads the floor
 * at 0.59, while a flat tint of 0.45 reads 0.68. So decoration matched to the
 * floor's number on disk comes back a third too light and reads as cards thrown
 * on the grass. This band is matched to the floor AS DRAWN instead: 0.40 of tint
 * lands on the floor's own drawn value. Re-measure with `art.check` on a world
 * frame if the key light or the floor texture changes.
 */
const DECORATION_BAND = [0.34, 0.46]

/**
 * How thick a flat thing lying in the floor is drawn.
 *
 * Twelve millimetres. At 110 screen pixels per metre a decal's side face is then
 * just over one pixel, and a decal whose side face can be seen reads as a card
 * lying on the grass rather than as the ground being worn.
 */
const DECAL_THICKNESS = 0.012

/** The surfaces the meadow is made of. Only the floor and the world outside the wall carry one. */
const FIELD_SURFACE = 'meadow/field.png'
const STONE = 'meadow/stone.png'
const TIMBER = 'meadow/timber.png'
const BARK = 'meadow/bark.png'
const LEAF = 'meadow/leaf.png'
const GRASS = 'meadow/grass.png'
const BARN = 'meadow/barn-board.png'
const SHINGLE = 'meadow/roof-shingle.png'
const HAY = 'meadow/hay.png'

/**
 * How densely the field surface repeats: one tile per 12.5 metres.
 *
 * The camera shows about 12 m of depth, so a repeat is never in frame beside
 * itself. tools/make-kitten-survivors-ground.mjs paints the tile for this exact
 * density — change one and the other is wrong.
 */
const FIELD_TILING = 0.08

/**
 * The floor and its decals, as grey tints on that one surface.
 *
 * A tint multiplies, so it can only take a surface down; the tile is painted at
 * the light end for that reason. Drawing a worn patch as the SAME picture a
 * shade darker is what makes it read as ground rather than as a decal — it
 * carries the same grain at the same scale, which no separate image would.
 *
 * THE FLOOR TAKES NO TINT. Its surface is painted to 0.62–0.72 and has to stay
 * there: the floor is most of the frame, so it alone decides value.p95, and
 * `bright-day` asks for at least 0.66 of that.
 */
const FLOOR_TINT = '#ffffff'   // none: the floor is the surface as painted
const WORN_TINT = '#dedede'    // darker, where it is walked
const WARM_TINT = '#fbeed2'    // warmer, where it is dry
const BARE_TINT = '#e8ddc6'    // darker and warmer, where the soil shows

/**
 * The wall, in one cold family. The only cold thing in the level and the only
 * thing over half a metre.
 */
const WALL_TINT = '#1d3d42'
const WALL_PIER_TINT = '#173237'
const WALL_CAP_TINT = '#284d50'

/**
 * The landmarks, in one warm family, three tones so a stepped plan reads as
 * steps rather than as one dark blot.
 */
const LANDMARK_LOW = '#402a1e'
const LANDMARK_MID = '#4f3527'
const LANDMARK_TOP = '#5e4030'

/** Decoration, in the ground's own hue and inside FLOOR_BAND of its value. */
const DECOR_GREEN = '#5f6d30'
const DECOR_DRY = '#687636'
const DECOR_DEEP = '#556327'

// --------------------------------------------------------------- determinism
/** mulberry32, seeded once. The same seed is the same meadow, for ever. */
function makeRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const random = makeRandom(0x4b177e4)
const between = (low, high) => low + random() * (high - low)
const pick = list => list[Math.floor(random() * list.length) % list.length]
/** Two decimals everywhere: past that a level file is noise nobody can diff. */
const round = value => Math.round(value * 100) / 100

// ------------------------------------------------------------- the placements
const entities = []
const counters = new Map()
/** Which band each placement is judged against. An id in none of these is outside the fence. */
const structures = new Set()
const decoration = new Set()
const floorDecals = new Set()

/** A readable, stable id per family, so the Scene panel is a list and not a wall. */
function nextId(family) {
  const next = (counters.get(family) || 0) + 1
  counters.set(family, next)
  return `${family}-${next}`
}

/**
 * One box of scenery, placed by the ground it stands on rather than by its centre.
 *
 * `at` is the centre of the box, which is right for the engine and wrong for a
 * person building a field: every placement would carry half its own height
 * around. This does that arithmetic once.
 */
function prop(family, { x, z, base = 0, size, yaw = null, texture = null, tint = null, tiling = null, solid = false, collider = null, material = null, steps = null, outline = null, opacity = null }) {
  const [width, height, depth] = size
  const mesh = { box: [round(width), round(height), round(depth)] }
  if (texture) mesh.texture = texture
  if (tint) mesh.tint = tint
  if (tiling !== null) mesh.tiling = tiling
  if (material) mesh.material = material
  if (steps !== null) mesh.steps = steps
  if (outline !== null) mesh.outline = outline
  if (opacity !== null) mesh.opacity = opacity

  const entity = {
    id: nextId(family),
    type: 'meadow-prop',
    at: [round(x), round(base + height / 2), round(z)],
    mesh
  }
  if (yaw !== null) entity.rotation = round(yaw)
  if (solid || collider) {
    // `collider` is separate from `size` because ROTATION IS DRAWN AND NOT
    // COLLIDED. `rotation` turns the mesh about Y and the 3D physics builds a
    // pure axis-aligned box from `collider.box` with no idea the entity was
    // turned — so anything solid that is also turned has to say what it blocks.
    const box = collider || [width, height, depth]
    entity.collider = { box: [round(box[0]), round(box[1]), round(box[2])] }
    entity.properties = { body: 'solid' }
  }
  entities.push(entity)
  return entity
}

/** A wall or landmark box. Judged against STRUCTURE_BAND. */
function structure(family, options) {
  const entity = prop(family, options)
  structures.add(entity.id)
  return entity
}

/** A decoration box. Judged against DECORATION_BAND and the decoration ceiling. */
function decorate(family, options) {
  const entity = prop(family, options)
  decoration.add(entity.id)
  return entity
}

/**
 * A flat piece of ground: a worn patch, a cut clearing, a wheel rut.
 *
 * It casts nothing and carries no outline. A patch is a twelve millimetre box
 * lying on the floor, and under a key at sixty degrees a shadow or a keyline
 * draws a hard rectangle of it across the grass beside it.
 */
function ground(family, { x, z, width, depth, texture = FIELD_SURFACE, tint = WORN_TINT, thickness = DECAL_THICKNESS, yaw = null, tiling = FIELD_TILING }) {
  const entity = prop(family, { x, z, base: 0, size: [width, thickness, depth], yaw, texture, tint, tiling })
  entity.mesh.shadow = false
  entity.mesh.outline = 0
  floorDecals.add(entity.id)
  return entity
}

// ------------------------------------------------------------ where things go
/** Circles nothing may be scattered into. */
const keepClear = [
  { x: 0, z: 0, radius: SPAWN_CLEAR }
]

/** The cart track, as the line it runs along. It crosses the whole field. */
const TRACK = [[-16, -11], [-8, -5], [-1, 3], [4, 10], [7, 16]]
  .map(([x, z]) => [round(x * FIELD / 15), round(z * FIELD / 15)])

/** Shortest distance from a point to the track, so scatter can stand back from it. */
function distanceToTrack(x, z) {
  let best = Infinity
  for (let index = 0; index < TRACK.length - 1; index++) {
    const [ax, az] = TRACK[index]
    const [bx, bz] = TRACK[index + 1]
    const dx = bx - ax
    const dz = bz - az
    const length = dx * dx + dz * dz
    const along = length ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / length)) : 0
    best = Math.min(best, Math.hypot(x - (ax + dx * along), z - (az + dz * along)))
  }
  return best
}

/** A free spot in the field, or null after enough tries. Rejection, not rows. */
function findSpot({ reach = FIELD - 1.5, apart = 2, offTrack = 1.4, tries = 40, placed = [] } = {}) {
  for (let attempt = 0; attempt < tries; attempt++) {
    const x = between(-reach, reach)
    const z = between(-reach, reach)
    if (keepClear.some(zone => Math.hypot(x - zone.x, z - zone.z) < zone.radius)) continue
    if (offTrack && distanceToTrack(x, z) < offTrack) continue
    if (placed.some(spot => Math.hypot(x - spot[0], z - spot[1]) < apart)) continue
    placed.push([x, z])
    return [x, z]
  }
  return null
}

// -------------------------------------------------------------------- the floor
/**
 * One slab, its top face at y = 0, carrying the field surface.
 *
 * The texture is the answer to most of the frame being one flat colour. It is
 * held to a tenth of its own value and drawn with no step a neighbouring pixel
 * could read as an edge, so it enriches the ground without spending any of the
 * frame's detail budget — `detail-stays-cheap` caps edgeDensity at 0.045 and
 * this surface measures zero on its own.
 */
entities.push({
  id: 'floor',
  type: 'ground',
  at: [0, -0.5, 0],
  mesh: { box: [SLAB * 2, 1, SLAB * 2], texture: FIELD_SURFACE, tiling: FIELD_TILING, tint: FLOOR_TINT },
  collider: { box: [SLAB * 2, 1, SLAB * 2] }
})

// ----------------------------------------------------------------- the wall
/**
 * Where the world stops, and the only solid thing in the level besides the floor.
 *
 * Each side is ONE solid box with a cap and a rhythm of piers drawn on it. Four
 * colliders instead of two hundred: the collision grid never sees a clump, and
 * the player is stopped by a straight line rather than by whichever shrub they
 * walked into.
 *
 * THE PIERS STAND PROUD OUTWARD ONLY, flush with the wall's inside face. A pier
 * projecting into the field is 1.5 m of solid in front of a player pinned
 * against the wall, and it hides the player from the player. Their tops still
 * break the cap line from this camera, which is all they are for.
 *
 * IT IS 1.2 m TALL, and that is the one place the arena spends height. The
 * silhouette ceiling exists because a thing of height h hides 2h of ground
 * behind it; behind the wall there is no ground the player has to read, so the
 * height is free. It is also what makes the boundary an edge the eye can see:
 * from anywhere in the field the wall occludes everything past it, so the arena
 * ends at a hard vertical face instead of trailing off into more grass.
 *
 * IT IS THE ONLY COLD COLOUR IN THE LEVEL. The reference reserves one cold hue
 * for the boundary and spends nothing else on it; so does this.
 */
const EDGE = FIELD + 1
const WALL_DEPTH = 1
const WALL_HEIGHT = 1.2
const WALL_CAP_HEIGHT = 0.16
const REACH = EDGE + WALL_DEPTH / 2
const PIER_SPACING = 4.4

const PIER_PROUD = 0.7

function wall(id, { x, z, alongX }) {
  const length = REACH * 2
  const body = alongX ? [length, WALL_HEIGHT, WALL_DEPTH] : [WALL_DEPTH, WALL_HEIGHT, length]
  const cap = alongX ? [length, WALL_CAP_HEIGHT, WALL_DEPTH + 0.34] : [WALL_DEPTH + 0.34, WALL_CAP_HEIGHT, length]
  const away = Math.sign(alongX ? z : x) * PIER_PROUD / 2
  structure(id, { x, z, size: body, tint: WALL_TINT, solid: true })
  structure(`${id}-cap`, { x, z, base: WALL_HEIGHT, size: cap, tint: WALL_CAP_TINT })
  for (let along = -REACH + PIER_SPACING / 2; along < REACH; along += PIER_SPACING) {
    structure(`${id}-pier`, {
      x: alongX ? along : x + away, z: alongX ? z + away : along,
      size: alongX ? [1.1, WALL_HEIGHT + 0.28, WALL_DEPTH + PIER_PROUD] : [WALL_DEPTH + PIER_PROUD, WALL_HEIGHT + 0.28, 1.1],
      tint: WALL_PIER_TINT
    })
  }
}
wall('wall-north', { x: 0, z: -EDGE, alongX: true })
wall('wall-south', { x: 0, z: EDGE, alongX: true })
wall('wall-west', { x: -EDGE, z: 0, alongX: false })
wall('wall-east', { x: EDGE, z: 0, alongX: false })

// -------------------------------------------------------------- the landmarks
/**
 * The one landmark at the start, and the shape the player learns first.
 *
 * A ring of set stones around the spawn. Each stone faces the centre, which is
 * the rule that makes the ring read as a ring rather than as scattered blocks —
 * a rotation the eye can explain is the opposite of an arbitrary one.
 *
 * ITS WORN FLOOR IS AN ANNULUS, NOT A DISC. Nothing may be drawn over the spawn
 * point: a ray straight down from the kitten has to find the floor, and
 * kitten-survivors/tests/see-ray.js fails on anything between the two.
 */
const RING_RADIUS = 5.5
const RING_STONES = 8
keepClear.push({ x: 0, z: 0, radius: RING_RADIUS + 1.6 })
for (let index = 0; index < 12; index++) {
  const angle = (index / 12) * Math.PI * 2 + 0.26
  ground('ring-floor', {
    x: Math.cos(angle) * RING_RADIUS, z: Math.sin(angle) * RING_RADIUS,
    width: between(3.4, 4.6), depth: between(3, 4.2), tint: BARE_TINT, yaw: between(0, 360)
  })
}
for (let index = 0; index < RING_STONES; index++) {
  const angle = (index / RING_STONES) * Math.PI * 2
  structure('ring-stone', {
    x: Math.cos(angle) * RING_RADIUS, z: Math.sin(angle) * RING_RADIUS,
    size: [1.6, FIELD_CEILING, 1.05],
    yaw: (angle * 180) / Math.PI,
    tint: index % 2 ? LANDMARK_MID : LANDMARK_TOP
  })
}

/**
 * A landmark: a raised centre block inside a broken square of low slabs.
 *
 * The camera looks almost straight down, so a landmark's PLAN is its
 * silhouette. A right-angled plan three metres across is the one shape nothing
 * else in the field has — decoration is small and blobby and the wall is a
 * straight line — so the class is told at a glance from directly above.
 *
 * One slab of the four is dropped, so no two landmarks are the same object and
 * every one is still obviously the same kind of object.
 */
function landmark(x, z, size) {
  const arm = size * 0.34
  structure('landmark', { x, z, size: [size * 0.5, FIELD_CEILING, size * 0.5], tint: LANDMARK_TOP })
  const missing = Math.floor(random() * 4)
  const sides = [[0, -1, true], [0, 1, true], [-1, 0, false], [1, 0, false]]
  sides.forEach(([dx, dz, alongX], index) => {
    if (index === missing) return
    structure('landmark-slab', {
      x: x + dx * size * 0.4, z: z + dz * size * 0.4,
      size: alongX ? [size * 0.8, 0.3, arm] : [arm, 0.3, size * 0.8],
      tint: index % 2 ? LANDMARK_MID : LANDMARK_LOW
    })
  })
}

/**
 * Landmarks on a grid around the ring, one every LANDMARK_STEP metres, jittered.
 *
 * Placed, not scattered. Rejection sampling left a quarter of the field with
 * nothing to steer by; a grid puts every point within seven metres of one, which
 * is inside what the camera reaches. The jitter stops identical spacings reading
 * as a printed pattern, and the grid grows with FIELD so density never changes.
 */
const LANDMARK_STEP = 7
const landmarkLine = []
for (let at = -Math.floor((FIELD - 3) / LANDMARK_STEP) * LANDMARK_STEP; at <= FIELD - 3; at += LANDMARK_STEP) landmarkLine.push(at)
for (const x of landmarkLine) {
  for (const z of landmarkLine) {
    if (x === 0 && z === 0) continue
    const at = [x + between(-1, 1), z + between(-1, 1)]
    const size = between(2, 2.8)
    keepClear.push({ x: at[0], z: at[1], radius: size * 0.8 })
    landmark(at[0], at[1], size)
  }
}

// ------------------------------------------------------- the flat landmarks
/**
 * Places drawn ENTIRELY IN THE FLOOR: a cut clearing, a cart track, a worn patch.
 *
 * They carry no height, so they orient a player without hiding one square metre
 * of the crowd. Each clearing is FOUR overlapping rectangles rather than one: a
 * single rectangle of cut grass reads as a card lying on the field however small
 * its tint step is, because the eye finds the straight edge before it finds the
 * colour.
 */
const CLEARINGS = [[-9.5, 9.5, 8.5, 7.5], [10, -9, 9, 8], [-11, -10, 7, 8.5]]
  .map(([x, z, width, depth]) => [x * FIELD / 15, z * FIELD / 15, width, depth])
for (const [x, z, width, depth] of CLEARINGS) {
  for (let piece = 0; piece < 4; piece++) {
    ground('mown', {
      x: x + between(-width / 4, width / 4), z: z + between(-depth / 4, depth / 4),
      width: width * between(0.5, 0.8), depth: depth * between(0.5, 0.8),
      tint: WARM_TINT, yaw: between(0, 360)
    })
  }
}

// Ruts along the cart track, as overlapping slabs turned to follow it.
for (let index = 0; index < TRACK.length - 1; index++) {
  const [ax, az] = TRACK[index]
  const [bx, bz] = TRACK[index + 1]
  const steps = Math.max(2, Math.round(Math.hypot(bx - ax, bz - az) / 3.2))
  for (let step = 0; step < steps; step++) {
    const along = (step + 0.5) / steps
    ground('rut', {
      x: ax + (bx - ax) * along, z: az + (bz - az) * along,
      width: between(2.6, 3.6), depth: Math.hypot(bx - ax, bz - az) / steps + 1.2,
      tint: BARE_TINT, yaw: (Math.atan2(bx - ax, bz - az) * 180) / Math.PI + between(-5, 5)
    })
  }
}

/** Worn patches, so the player crosses places rather than a plane. */
const patchPlaces = []
for (let index = 0; index < Math.round(FIELD * FIELD * 4 / 26); index++) {
  const spot = findSpot({ reach: FIELD - 2, apart: 3.2, offTrack: 0, placed: patchPlaces })
  if (!spot) continue
  const roll = random()
  ground('patch', {
    x: spot[0], z: spot[1],
    width: between(2.2, 4.4), depth: between(2, 4),
    tint: roll < 0.42 ? WORN_TINT : roll < 0.82 ? WARM_TINT : BARE_TINT,
    yaw: between(0, 360)
  })
}

// ------------------------------------------------------------- the decoration
/**
 * Clumps of scrub, and the only thing left in the field.
 *
 * They are held in the ground's hue and value ON PURPOSE: decoration must not
 * compete for a glance, and the class the player is meant to ignore is the one
 * that belongs to the ground. What makes them visible at all is that they stand
 * up — the key gives each a lit top and a shaded side, so the field reads as
 * having relief without gaining one object the player has to identify.
 *
 * EACH CLUMP IS THREE OR FOUR OVERLAPPING LOBES, never one box. A single box
 * seen from almost straight down is a rectangle, and a rectangle the colour of
 * grass still reads as a card lying on it; overlapping lobes have no outline
 * that closes, which is the only irregular shape a box renderer draws.
 *
 * One clump per thirteen square metres, which puts three or four in a frame.
 */
const clumpPlaces = []
for (let index = 0; index < Math.round(FIELD * FIELD * 4 / 13); index++) {
  const spot = findSpot({ reach: FIELD - 1.2, apart: 3, placed: clumpPlaces })
  if (!spot) continue
  const tint = pick([DECOR_GREEN, DECOR_GREEN, DECOR_DEEP, DECOR_DRY])
  const other = tint === DECOR_GREEN ? DECOR_DEEP : DECOR_GREEN
  const height = between(0.1, DECORATION_CEILING)
  const width = between(0.9, 2.1)
  const lobes = 3 + (random() < 0.5 ? 1 : 0)
  for (let lobe = 0; lobe < lobes; lobe++) {
    const shrink = lobe === 0 ? 1 : between(0.45, 0.8)
    decorate('clump', {
      x: spot[0] + (lobe === 0 ? 0 : between(-width / 2, width / 2)),
      z: spot[1] + (lobe === 0 ? 0 : between(-width / 2, width / 2)),
      size: [width * shrink, height * (lobe === 0 ? 1 : between(0.55, 0.95)), width * shrink * between(0.6, 1.1)],
      yaw: between(0, 360), tint: lobe % 2 ? other : tint
    })
  }
}

// ---------------------------------------------------------- outside the wall
/**
 * The world past the boundary.
 *
 * The wall occludes all of it in a play frame, so none of this is drawn for the
 * player — it is what the editor and a wide capture show, and it is kept small
 * for that reason. All the height in the level is out here.
 */
const WATER_IN = EDGE + WALL_DEPTH / 2 + 1
const WATER_OUT = 32
const WATER_MID = (WATER_IN + WATER_OUT) / 2
const WATER_WIDTH = WATER_OUT - WATER_IN
const WATER_TINT = '#63c2e8'

for (const [id, x, z, width, depth] of [
  ['water-north', 0, -WATER_MID, WATER_OUT * 2, WATER_WIDTH],
  ['water-south', 0, WATER_MID, WATER_OUT * 2, WATER_WIDTH],
  ['water-west', -WATER_MID, 0, WATER_WIDTH, WATER_IN * 2],
  ['water-east', WATER_MID, 0, WATER_WIDTH, WATER_IN * 2]
]) {
  const water = prop(id, { x, z, base: 0, size: [width, DECAL_THICKNESS, depth], tint: WATER_TINT })
  water.mesh.shadow = false
  water.mesh.outline = 0
}

/**
 * The far shore: a stone ledge, drawn as a dark riser under a light cap.
 *
 * A step UP away from the field, because the camera looks down and outward — the
 * riser of a step down faces away and cannot be seen at all.
 */
const LEDGE_TINT_TOP = '#e4ddcb'
const LEDGE_TINT_FACE = '#9d9484'
for (const [id, x, z, alongX] of [
  ['shore-north', 0, -WATER_OUT, true],
  ['shore-south', 0, WATER_OUT, true],
  ['shore-west', -WATER_OUT, 0, false],
  ['shore-east', WATER_OUT, 0, false]
]) {
  const length = WATER_OUT * 2 + 6
  const face = alongX ? [length, 0.9, 1.4] : [1.4, 0.9, length]
  const cap = alongX ? [length, 0.16, 5] : [5, 0.16, length]
  const step = z < 0 || x < 0 ? -1 : 1
  prop(id, { x, z, size: face, texture: STONE, tiling: 0.5, tint: LEDGE_TINT_FACE })
  prop(id, {
    x: alongX ? x : x + step * 1.8, z: alongX ? z + step * 1.8 : z,
    base: 0.9, size: cap, texture: STONE, tiling: 0.4, tint: LEDGE_TINT_TOP
  })
}

/**
 * A tree: a trunk and three canopy masses stepped up and offset.
 *
 * Three boxes rather than one because the engine draws boxes and quads and
 * nothing else, and one box is a hedge. Stepping them gives the only thing a
 * silhouette can have here — a change of width up its height.
 */
function tree(x, z, scale) {
  const trunkHeight = 2.4 * scale
  prop('trunk', { x, z, size: [0.7 * scale, trunkHeight, 0.7 * scale], yaw: between(0, 360), texture: BARK, tiling: 1.2, tint: '#e2cdb0' })
  let base = trunkHeight * 0.72
  let width = 4.6 * scale
  for (let layer = 0; layer < 3; layer++) {
    const height = between(1.5, 2.3) * scale
    prop('canopy', {
      x: x + between(-0.5, 0.5) * scale, z: z + between(-0.5, 0.5) * scale,
      base, size: [width, height, width * between(0.82, 1.12)],
      yaw: between(0, 360), texture: LEAF, tint: '#cfe0ab', tiling: 0.55
    })
    base += height * 0.78
    width *= between(0.62, 0.78)
  }
}
for (let index = 0; index < 10; index++) {
  const angle = between(0, Math.PI * 2)
  // A ring of trees has to be a SQUARE ring, because the field is a square.
  // Dividing by the larger of the two direction cosines pushes each tree out
  // until BOTH its coordinates clear the water.
  const reach = Math.max(Math.abs(Math.cos(angle)), Math.abs(Math.sin(angle)))
  const radius = (WATER_OUT + between(5, 18)) / reach
  tree(Math.cos(angle) * radius, Math.sin(angle) * radius, between(0.85, 1.5))
}

/**
 * The barn, north-west, and the largest thing in the world.
 *
 * The roof is a stair of five boxes rather than a slope, because an entity can
 * only be turned about Y — there is no pitch and no roll in the level format.
 */
const BARN_X = -46
const BARN_Z = -42
prop('barn', { x: BARN_X, z: BARN_Z, size: [16, 7.5, 11], yaw: 14, texture: BARN, tiling: 0.55 })
prop('barn-door', { x: BARN_X + 4.6, z: BARN_Z + 5.2, size: [4.4, 5.2, 0.5], yaw: 14, texture: TIMBER, tiling: 0.5 })
for (let step = 0; step < 5; step++) {
  const inset = step * 1.5
  prop('barn-roof', {
    x: BARN_X, z: BARN_Z, base: 7.5 + step * 0.66,
    size: [16.8 - inset * 0.2, 0.7, 11.6 - inset * 2], yaw: 14, texture: SHINGLE, tiling: 1.1, tint: '#cbbcae'
  })
}
prop('silo', { x: BARN_X + 11.5, z: BARN_Z - 2, size: [5, 12, 5], yaw: 22, texture: SHINGLE, tiling: 0.8, tint: '#d9cec2' })
prop('silo-cap', { x: BARN_X + 11.5, z: BARN_Z - 2, base: 12, size: [5.6, 1.1, 5.6], yaw: 22, texture: SHINGLE, tiling: 1.2, tint: '#cbbcae' })

const farmyard = prop('farmyard', { x: BARN_X + 2, z: BARN_Z - 8, base: 0, size: [28, DECAL_THICKNESS, 36], texture: FIELD_SURFACE, tiling: FIELD_TILING, tint: BARE_TINT })
farmyard.mesh.shadow = false
farmyard.mesh.outline = 0

const baleSpots = [[-44, -55], [-39, -52], [-48, -50], [-43.5, -53.5], [-34, -58], [-51, -58]]
baleSpots.forEach(([x, z], index) => {
  prop('bale', { x, z, base: index === 3 ? 1.5 : 0, size: [2.4, 1.5, 1.7], yaw: between(0, 360), texture: HAY, tiling: 0.9, tint: '#f5e4b8' })
})

/**
 * A far ridge of hills, LOW AND WIDE.
 *
 * Distant land sits ON the horizon: tall flat-topped blocks at this range read
 * as a dam. They exist so the sky does not meet the ground in a straight line,
 * and the fog takes most of them.
 */
for (let index = 0; index < 12; index++) {
  const angle = (index / 12) * Math.PI * 2 + 0.4
  const radius = between(62, 86)
  prop('hill', {
    x: Math.cos(angle) * radius, z: Math.sin(angle) * radius,
    size: [between(34, 62), between(2.2, 6), between(24, 42)],
    yaw: between(0, 360), texture: pick([GRASS, LEAF]), tint: '#d4e0c2', tiling: 0.28
  })
  if (index % 2) {
    const treeAngle = angle + between(-0.08, 0.08)
    tree(Math.cos(treeAngle) * radius * 0.9, Math.sin(treeAngle) * radius * 0.9, between(1.4, 2.4))
  }
}

// -------------------------------------------------------------------- the light
/**
 * One key, one cool counter-fill, one ambient. Nothing else.
 *
 * BRIGHT WARM DAY. `art/world/bible.md` sets four measured bounds this block has
 * to clear: value.p95 at least 0.66, value.median at least 0.43, value.spread at
 * least 0.27 and warmShare at least 0.35. Run `art.check` after changing it.
 *
 * INTENSITY IS THE ONE DIAL, and the toon ramp makes it a staircase rather than a
 * slope: `steps: 4` quantises the diffuse term, so the floor's drawn value only
 * moves when the key pushes it onto the next step. The floor's texture measures
 * 0.674 on disk and at intensity 3 it drew at 0.47 — the light under-drove the
 * surface by a third, and `bright-day` failed on the merged build for that reason
 * and no other. The same 30 second frame, measured with `art.check`:
 *
 *   key 6.2   p95 0.643   key 7.4   p95 0.665   key 8.0   p95 0.795
 *
 * `bright-day` wants 0.66, and 8.0 is the first step with margin. What this frame
 * holds at 8.0, over four moments of one run:
 *
 *   world alone   p05 0.429  median 0.769  p95 0.830  spread 0.401  warm 1.000
 *   arc 0:25      p05 0.248  median 0.639  p95 0.770  spread 0.522  warm 0.998
 *   arc 0:30      p05 0.220  median 0.555  p95 0.795  spread 0.575  warm 0.998
 *   arc 0:45      p05 0.216  median 0.548  p95 0.643  spread 0.427  warm 0.712
 *
 * The last is the player pinned at the wall, where the boundary is 29% of the
 * frame and takes the bright end with it. It is the only sampled moment that
 * misses `bright-day`, by 0.017. Raise the floor texture's own value, which is
 * tools/make-kitten-survivors-ground.mjs, and the key comes back down.
 *
 * The key is a light ENTITY rather than `world.sun`, because only a light entity
 * casts a shadow. `world.sun` is demoted to a cool counter-fill from the
 * opposite side, which keeps shaded faces from going flat.
 *
 * It COMES FROM THE SIDE, not from behind the camera: a key down the view axis
 * lights every face the player sees and throws every shadow directly behind the
 * thing that cast it, so the scene pays for a shadow pass and shows none.
 *
 * THE KEY CASTS NO SHADOW, and that is a measurement rather than a preference.
 * `range` sizes the shadow camera half either side and the map is 1024 texels
 * whatever the range. Shrinking the arena took the range from 96 to 34 and did
 * clear the diagonal hatching the wide box produced — edgeDensity measured 0.011
 * with the pass on — but the ground still self-shadows uniformly, and the same
 * frame reads value.p95 0.615 with the pass on against 0.732 with it off. The
 * bible asks for 0.66. So the pass costs a tenth of the picture's brightness and
 * returns a shadow 30 cm long, because nothing inside the wall is over 0.5 m.
 *
 * TURN IT BACK ON when the ground stops self-shadowing — a depth bias, or a
 * floor that does not cast. The direction below already aims across the field,
 * so switching `shadow` to true is the only edit needed.
 */
entities.push({
  id: 'key-light', type: 'light', at: [0, 40, 0],
  properties: { kind: 'directional', color: '#fff9ee', intensity: 8, direction: [-0.5, -0.84, -0.21], range: 34, shadow: false }
})

// ---------------------------------------------------------------- the player
// Last, so it is easy to find. Its y is HALF THE KITTEN'S OWN HEIGHT, because
// the top of the ground is zero. The cat's body is 1.0 x 0.90 x 1.6 m, so 0.45.
// The type's start() lifts the body upward only, so a wrong number here plays
// correctly and draws the cat belly-deep in a stopped editor.
entities.push({ id: 'you', type: 'kitten', at: [0, 0.45, 0] })

// ------------------------------------------------------------------- the level
const SKY = '#a9dcf2'
const level = {
  about: [
    'A meadow on a bright day, and the arena of Kitten Survivors.',
    'GENERATED — run `node tools/make-kitten-survivors-meadow.mjs` to rebuild it; edits made here are lost on the next run.',
    'The top of the ground is y = 0 and the field is 50 m across — the smallest the run survives, and near enough that a player reaches the wall.',
    'It draws three classes and nothing else: a 1.2 m cold wall that blocks, warm dark right-angled landmarks that name a place, and low ground-hue decoration that says nothing.',
    'The direction every other lane matches is kitten-survivors/art/world/bible.md.',
    'Enemies are not placed here: a survivor\'s crowd arrives on a clock, not out of a level file.'
  ].join(' '),
  seed: 1,
  // `third-person`, not `3d`: `3d` puts the eye exactly at the followed entity.
  // `distance` holds the eye behind the kitten, and the arena is built for this
  // height — inside the wall nothing is taller than 0.5 m because the camera
  // looks down at 60 degrees from nine metres back. The horde plugin measures
  // its spawn ring from this rule, so these numbers ARE the game's spawn
  // distance: move the camera and the ring moves with it.
  camera: {
    follow: 'you',
    mode: 'third-person',
    pitch: -1.05,
    yaw: 0,
    distance: 9,
    offsetY: 0.35,
    lerp: 0.16,
    lookAhead: 0.25,
    bounds: [-FIELD, -FIELD, FIELD, FIELD],
    fov: 55,
    at: [0, 12],
    zoom: 32
  },
  world: {
    // Flat sky, no panorama: a painted panorama is the darkest thing in frame
    // and a phone sees the top third of it.
    sky: SKY,
    // THE FOG IS THE SKY'S OWN COLOUR, and that is the whole reason it is here.
    // Distant ground fades into exactly what is behind it, so there is no seam
    // between ground and sky at any camera angle and the world has no visible
    // edge. FogExp2 washes a surface by 1 - exp(-(density * metres)^2).
    fog: [0.0075, SKY],
    // Ambient plus the counter-fill IS the shadow, so the two of them set the
    // dark end of a frame with nothing dark in it. The dark props are now the
    // dark end, so this only has to keep shaded faces from going black.
    ambient: { intensity: 0.26, color: '#efe6d2' },
    sun: { direction: [0.6, -0.5, -0.62], intensity: 0.3, color: '#cfe0ee' },
    post: [
      { smaa: true },
      // Threshold above the lit grass. Below it the field itself blooms and the
      // whole frame comes back milky.
      { bloom: { strength: 0.14, threshold: 0.85, radius: 0.5 } },
      // NO TINT. A warm white tint multiplies every pixel toward the tint and
      // reads as fog without being fog. Grade contrast and chroma only.
      { grade: { contrast: 1.06, saturation: 0.92 } }
    ]
  },
  entities
}

// ------------------------------------------------------------------- writing
/**
 * One entity per line.
 *
 * Several hundred placements at eight lines each is a file nobody can scan; at
 * one line each a diff shows which prop moved.
 */
function write(level) {
  const head = JSON.stringify({ about: level.about, seed: level.seed, camera: level.camera, world: level.world }, null, 2)
  const lines = level.entities.map(entity => `    ${JSON.stringify(entity)}`)
  return `${head.slice(0, -2)},\n  "entities": [\n${lines.join(',\n')}\n  ]\n}\n`
}

const text = write(level)
fs.writeFileSync(OUT, text)

// --------------------------------------------------------------- proving it
/**
 * Read the level back and prove the rules it is built on.
 *
 * Read back rather than checked in memory, because a level file that is not
 * valid JSON fails as an empty viewport rather than as an error anybody sees.
 */
const reread = JSON.parse(fs.readFileSync(OUT, 'utf8'))

const hex = value => [0, 2, 4].map(at => parseInt(value.slice(1 + at, 3 + at), 16) / 255)
const luminance = ([red, green, blue]) => 0.2126 * red + 0.7152 * green + 0.0722 * blue

/**
 * sRGB to linear light and back.
 *
 * EVERY AVERAGE AND EVERY MULTIPLY BELOW HAPPENS IN LINEAR LIGHT, because that
 * is where the renderer does them. Averaging a texture's bytes in sRGB reports a
 * surface brighter than the one drawn — field.png reads 0.674 that way and 0.548
 * in linear — and comparing a flat tint against that number puts decoration a
 * fifth lighter than the floor it is supposed to disappear into.
 */
const toLinear = channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
const toSrgb = channel => channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055

/** Mean colour of a texture file, as the sRGB colour the renderer draws for it. */
const textureColour = new Map()
async function meanColour(name) {
  if (textureColour.has(name)) return textureColour.get(name)
  const image = await readImage(`kitten-survivors/assets/${name}`)
  const total = [0, 0, 0]
  const pixels = image.width * image.height
  for (let at = 0; at < image.data.length; at += 4) {
    for (let channel = 0; channel < 3; channel++) total[channel] += toLinear(image.data[at + channel] / 255)
  }
  const mean = total.map(sum => sum / pixels)
  textureColour.set(name, mean)
  return mean
}

/**
 * What one placement's surface is worth as a value, before any light reaches it.
 *
 * A tint multiplies its texture channel by channel, so the two have to be
 * multiplied and then read as one luminance. An untextured placement is its tint
 * alone; one with neither gets the engine's per-type colour, which is
 * deliberately visible and is caught as unfinished.
 */
async function albedo(mesh) {
  const tint = mesh.tint ? hex(mesh.tint).map(toLinear) : null
  const surface = mesh.texture ? await meanColour(mesh.texture) : null
  if (!surface && !tint) return null
  const lit = surface && tint ? surface.map((channel, index) => channel * tint[index]) : (surface || tint)
  return luminance(lit.map(toSrgb))
}

const floor = reread.entities.find(entity => entity.id === 'floor')
const floorValue = await albedo(floor.mesh)

const problems = []
const structureValues = []
const decorationValues = []
const decalValues = []

for (const entity of reread.entities) {
  if (entity.type !== 'meadow-prop') continue
  const [x, y, z] = entity.at
  const height = entity.mesh?.box?.[1]
  const inside = Math.abs(x) <= FIELD && Math.abs(z) <= FIELD

  // A box whose bottom face is under the floor draws a line where it cuts the
  // ground, and at this camera angle that line is the first thing the eye finds.
  if (height !== undefined && y - height / 2 < -0.001) {
    problems.push(`${entity.id} has its bottom face at ${round(y - height / 2)} — under the floor`)
  }

  // A prop inside the fence taller than the ceiling is the one mistake that
  // would not look wrong in a screenshot and would quietly cost the player a run.
  if (inside && height !== undefined && height > FIELD_CEILING + 0.001) {
    problems.push(`${entity.id} is ${height} m tall inside the fence — the ceiling is ${FIELD_CEILING} m`)
  }

  if (decoration.has(entity.id) && height > DECORATION_CEILING + 0.001) {
    problems.push(`${entity.id} is decoration and ${height} m tall — the decoration ceiling is ${DECORATION_CEILING} m`)
  }

  const value = await albedo(entity.mesh)
  if (value === null) {
    problems.push(`${entity.id} names neither a texture nor a tint`)
    continue
  }

  if (structures.has(entity.id)) {
    structureValues.push(value)
    if (value < STRUCTURE_BAND[0] - 0.001 || value > STRUCTURE_BAND[1] + 0.001) {
      problems.push(`${entity.id} is value ${value.toFixed(3)} — the wall and landmark band is ${STRUCTURE_BAND[0]} to ${STRUCTURE_BAND[1]}`)
    }
    continue
  }

  if (decoration.has(entity.id)) {
    decorationValues.push(value)
    if (value < DECORATION_BAND[0] - 0.001 || value > DECORATION_BAND[1] + 0.001) {
      problems.push(`${entity.id} is value ${value.toFixed(3)} — the decoration band is ${DECORATION_BAND[0]} to ${DECORATION_BAND[1]}`)
    }
    continue
  }

  if (floorDecals.has(entity.id)) {
    decalValues.push(value)
    if (Math.abs(value - floorValue) > FLOOR_BAND + 0.001) {
      problems.push(`${entity.id} is ${value.toFixed(3)}, ${Math.abs(value - floorValue).toFixed(3)} from the floor's ${floorValue.toFixed(3)} — the band is ${FLOOR_BAND}`)
    }
    continue
  }

  // Outside the wall a tree and a barn are allowed their own value, because
  // nothing the player has to read ever crosses them.
  if (inside) problems.push(`${entity.id} is inside the fence and in no class — every placement in the field is wall, landmark or decoration`)
}

const byFamily = new Map()
for (const entity of reread.entities) {
  const family = String(entity.id || entity.type).replace(/-\d+$/, '')
  byFamily.set(family, (byFamily.get(family) || 0) + 1)
}
const solids = reread.entities.filter(entity => entity.collider).length
const span = list => list.length ? `${Math.min(...list).toFixed(3)}–${Math.max(...list).toFixed(3)}` : '—'

console.log('')
console.log(`kitten-survivors/levels/meadow.json — ${reread.entities.length} placements, ${Math.round(text.length / 1024)} kB`)
console.log(`${solids} collide; the field is ${FIELD * 2} m across and clear to ${FIELD_CEILING} m; the wall is ${WALL_HEIGHT} m`)
console.log('')
console.log(`floor           value ${floorValue.toFixed(3)}`)
console.log(`${String(structureValues.length).padStart(3)} structures  value ${span(structureValues)}   band ${STRUCTURE_BAND[0]}–${STRUCTURE_BAND[1]}`)
console.log(`${String(decorationValues.length).padStart(3)} decoration  value ${span(decorationValues)}   band ${DECORATION_BAND[0]}–${DECORATION_BAND[1]}`)
console.log(`${String(decalValues.length).padStart(3)} decals      value ${span(decalValues)}   band ${(floorValue - FLOOR_BAND).toFixed(3)}–${(floorValue + FLOOR_BAND).toFixed(3)}`)
console.log('')
for (const [family, count] of [...byFamily].sort((a, b) => b[1] - a[1])) {
  console.log(`${family.padEnd(20)}${String(count).padStart(5)}`)
}
console.log('')
if (problems.length) {
  for (const problem of problems.slice(0, 20)) console.error(`[make-kitten-survivors-meadow] ${problem}`)
  if (problems.length > 20) console.error(`[make-kitten-survivors-meadow] and ${problems.length - 20} more`)
  process.exitCode = 1
}
