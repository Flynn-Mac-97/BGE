#!/usr/bin/env node
/**
 * Build kitten-survivors/levels/meadow.json.
 *
 *   node tools/make-kitten-survivors-meadow.mjs
 *
 * WHY A TOOL AND NOT A HAND-WRITTEN FILE. The meadow is a few thousand
 * placements. `docs/design.md` lists "tilemaps and bulk placement" as a known
 * gap, and it is the gap you feel: there is no repeat, no array, no group and no
 * prefab in the level format, so a hedgerow is thirty literal JSON objects and a
 * tree is four. Scattering two thousand tufts by hand is transcription, and a
 * transcribed field ends up in rows because a person cannot invent two thousand
 * unbiased numbers.
 *
 * The level file this writes is still the truth. It is ordinary placements, the
 * editor can select and drag every one, and nothing at runtime knows this tool
 * exists. Re-running it overwrites whatever the editor last saved, so the rule
 * is the ordinary one for generated files: change the arena here, not there, and
 * re-run. EDIT THIS FILE AND THE LEVEL TOGETHER OR NEITHER — a hand edit to the
 * level is lost silently the next time anyone builds.
 *
 * Everything is seeded from one number, so the same seed gives the same meadow
 * byte for byte and a re-run is a reviewable diff.
 *
 * The direction this builds to is kitten-survivors/art/world/bible.md, generated
 * by the Art Direction plugin. `art.check` tests a frame of this meadow against
 * it. The four rules that shape almost every number below:
 *
 *   The top of the ground is y = 0, and a prop of height h is placed at y = h/2.
 *
 *   Inside the fence nothing the arena draws is taller than 0.5 m. The camera
 *   looks down at 60 degrees, so an object of height h hides roughly 2h of
 *   ground behind it. Half a metre hides one metre — less than one enemy. A
 *   fence post at 1.2 m hides two and a half, which is three enemies the player
 *   never saw coming, so fence posts stand on the fence and the field gets tufts.
 *
 *   Every prop inside the fence sits in one narrow value band, PROP_BAND below.
 *   The creatures are the only dark-keyed things on screen, so an enemy crossing
 *   a prop is never the same value as it.
 *
 *   Everything lying in the floor stays within FLOOR_BAND of the floor. A decal
 *   further out than that reads as a sheet of paper thrown on a lawn, which is
 *   what `ground-reads-as-one-surface` in the bible forbids.
 *
 * The last two are CHECKED, not asserted. The tool reads every texture it names,
 * multiplies its mean colour by the tint the placement carries, and fails the
 * build on anything outside its band.
 *
 * WHAT THE CAMERA ACTUALLY SHOWS, because every density here is set from it: at
 * `distance` 9 and `fov` 55 on a 540x960 frame the ground in view is about 5 m
 * across and 12 m deep — roughly 45 square metres. One prop per 8 square metres
 * puts five in frame and reads as an empty field. The scatter below is set at
 * about one per 5, and the rest of the ground's detail is in the field texture
 * rather than in entities, because a texel costs nothing to draw and every
 * standing box spends some of the frame's edge budget on its own silhouette.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { readImage } from '../plugins/builtin/art-direction/image.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'kitten-survivors/levels/meadow.json')

// --------------------------------------------------------------- the numbers
/** Half the play field, measured to the inside face of the boundary. */
const FIELD = 45
/**
 * Half the ground slab.
 *
 * It reaches far past anything the camera can reach. The fog below is the sky's
 * own colour and closes to 97% by the slab's corner, so the ground never ends at
 * an edge — it ends by becoming the sky. This is the whole of the fix for a
 * visible world edge, and it costs one number.
 */
const SLAB = 130
/** Nothing is scattered within this of the origin, so the first frame is clean. */
const SPAWN_CLEAR = 3.5
/** The tallest anything inside the fence is allowed to be. */
const FIELD_CEILING = 0.5

/**
 * The value band every prop inside the fence sits in, as luminance 0 to 1.
 *
 * THE BAND IS SET BY WHAT ELSE IS ON SCREEN, not by taste. The horde holds 0.14
 * to 0.33 — crow 0.14, boar 0.19, wasp 0.26, rat 0.29, hound 0.33 — and the cat
 * holds 0.92 on its top surfaces. The ground and everything standing on it are
 * the mid band that separates the two. Drift below 0.44 and a crow crossing a
 * prop disappears; drift above 0.72 and the prop competes with the cat.
 */
const PROP_BAND = [0.46, 0.70]

/**
 * How far anything lying in the floor may stand from the floor's own value.
 *
 * A tenth. Far enough that a worn patch reads as worn, near enough that the
 * field still reads as one surface.
 */
const FLOOR_BAND = 0.1

/**
 * How thick a flat thing lying in the floor is drawn.
 *
 * Twelve millimetres. At 110 screen pixels per metre a decal's side face is
 * then just over one pixel, and a decal whose side face can be seen reads as a
 * card lying on the grass rather than as the ground being worn.
 */
const DECAL_THICKNESS = 0.012

/** The surfaces the meadow is made of. */
const FIELD_SURFACE = 'meadow/field.png'
const EARTH = 'meadow/earth.png'
const POND = 'meadow/pond.png'
const STONE = 'meadow/stone.png'
const TIMBER = 'meadow/timber.png'
const BARK = 'meadow/bark.png'
const LEAF = 'meadow/leaf.png'
const GRASS = 'meadow/grass.png'
const DRY = 'meadow/grass-dry.png'
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
 * THE FLOOR TAKES NO TINT. Its surface is painted to 0.62–0.72, the top of the
 * band the ground is allowed, and it has to stay there: the floor is most of
 * the frame, so it alone decides value.p95, and the bible asks for at least
 * 0.66 of that. Every decal is the same picture worn DOWN from the floor,
 * which is also the only direction a multiply can go.
 */
const FLOOR_TINT = '#ffffff'   // none: the floor is the surface as painted
const WORN_TINT = '#dedede'    // darker, where it is walked
const WARM_TINT = '#fbeed2'    // warmer, where it is dry
const BARE_TINT = '#e8ddc6'    // darker and warmer, where the soil shows

/** The flat colours, for the small things a texture would be wasted on. */
const TUFT_GREEN = '#759041'
const TUFT_DEEP = '#698338'
const BUSH_GREEN = '#698338'
const BUSH_WARM = '#a8b06a'
const FLOWER_GOLD = '#bfae72'
const FLOWER_CREAM = '#b5af83'
const HEDGE_GREEN = '#759041'
const BANK_GREEN = '#9aab6c'

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
/** Ids of everything lying in the floor, so the band check knows which rule applies. */
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

/**
 * A flat piece of ground: a worn patch, a cut clearing, a wheel rut.
 *
 * It casts nothing and carries no outline. A patch is a five centimetre box
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

/** The cart track, as the line it runs along. Ruts follow it. */
const TRACK = [
  [-45, -32], [-30, -15], [-16, 2], [-8, 18], [-3, 32], [0, 45]
]

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
function findSpot({ reach = FIELD - 2, apart = 2, offTrack = 1.6, tries = 30, placed = [] } = {}) {
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
 * The texture is the answer to two thirds of the frame being one flat colour. It
 * is held to a tenth of its own value and drawn with no step a neighbouring
 * pixel could read as an edge, so it enriches the ground without spending any of
 * the frame's detail budget — `detail-stays-cheap` caps edgeDensity at 0.045 and
 * this surface measures zero on its own.
 */
entities.push({
  id: 'floor',
  type: 'ground',
  at: [0, -0.5, 0],
  mesh: { box: [SLAB * 2, 1, SLAB * 2], texture: FIELD_SURFACE, tiling: FIELD_TILING, tint: FLOOR_TINT },
  collider: { box: [SLAB * 2, 1, SLAB * 2] }
})

// --------------------------------------------------------------- the pond
const POND_X = 23
const POND_Z = 14
const POND_R = 7
keepClear.push({ x: POND_X, z: POND_Z, radius: POND_R + 2.4 })

prop('pond', { x: POND_X, z: POND_Z, base: -0.04, size: [POND_R * 1.9, 0.08, POND_R * 1.6], yaw: 12, texture: POND, tiling: 0.35 })
prop('pond', { x: POND_X - 3.4, z: POND_Z + 2.2, base: -0.03, size: [6.5, 0.08, 5.4], yaw: -24, texture: POND, tiling: 0.35 })
for (let index = 0; index < 11; index++) {
  const angle = (index / 11) * Math.PI * 2 + 0.3
  ground('pond-bank', {
    x: POND_X + Math.cos(angle) * (POND_R + between(0.6, 1.8)),
    z: POND_Z + Math.sin(angle) * (POND_R * 0.85 + between(0.6, 1.8)),
    width: between(3.5, 6.5), depth: between(2.6, 4.6), tint: BARE_TINT,
    yaw: between(0, 360)
  })
}
// Reeds: the one place the field is allowed a vertical, and they stop at the
// ceiling like everything else in it.
for (let index = 0; index < 20; index++) {
  const angle = between(0, Math.PI * 2)
  const radius = POND_R * between(0.95, 1.15)
  prop('reed', {
    x: POND_X + Math.cos(angle) * radius,
    z: POND_Z + Math.sin(angle) * radius * 0.85,
    size: [between(0.3, 0.6), between(0.34, FIELD_CEILING), between(0.16, 0.3)],
    yaw: between(0, 360), texture: LEAF, tiling: 2, tint: '#bac0ad'
  })
}

// -------------------------------------------------------- the flat landmarks
/**
 * Places the player can name, drawn ENTIRELY IN THE FLOOR.
 *
 * A survivor's player has to know where they are while looking at a hundred
 * enemies, and the usual answer — a tower, a statue, a big rock — is the one
 * thing this camera cannot afford, because anything tall enough to see across
 * the field is tall enough to hide the crowd behind it. So the landmarks have no
 * height: a cut clearing, a ring of set stones, a cart track.
 */
const RING_X = -19
const RING_Z = -21
keepClear.push({ x: RING_X, z: RING_Z, radius: 7 })
ground('stone-ring', { x: RING_X, z: RING_Z, width: 12.5, depth: 12, tint: BARE_TINT, yaw: 18 })
for (let index = 0; index < 9; index++) {
  const angle = (index / 9) * Math.PI * 2
  prop('stone-set', {
    x: RING_X + Math.cos(angle) * 5.1,
    z: RING_Z + Math.sin(angle) * 5.1,
    size: [between(1.5, 2.3), 0.16, between(1.2, 1.9)],
    yaw: (angle * 180) / Math.PI + between(-14, 14), texture: STONE, tiling: 0.7, tint: '#dad2c4'
  })
}

/**
 * Cut clearings: the light end of the floor's range, and its largest shapes.
 *
 * Each is FOUR overlapping rectangles rather than one. A single rectangle of
 * cut grass reads as a card lying on the field however small its tint step is,
 * because the eye finds the straight edge before it finds the colour. Four
 * turned and offset ones have no outline that closes, which is the only
 * irregular shape a box renderer can draw.
 */
const CLEARINGS = [
  [-23, 25, 17, 15.5], [26, -24, 19, 16], [-33, -36, 14, 18], [12, 33, 22, 14]
]
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
      width: between(3, 4.2), depth: Math.hypot(bx - ax, bz - az) / steps + 1.4,
      tint: BARE_TINT, yaw: (Math.atan2(bx - ax, bz - az) * 180) / Math.PI + between(-5, 5)
    })
  }
}

/**
 * The field's worn and cut patches, and the second half of the answer to a flat
 * floor.
 *
 * The texture gives the ground its metre-scale grain; these give it its
 * ten-metre shape, so the player crosses places rather than a plane. They are
 * the SAME surface a shade up or down, held inside FLOOR_BAND, and they overlap
 * on purpose — a rectangle whose whole outline shows reads as a rectangle, and
 * two overlapping ones read as a shape. That is the only irregular edge a
 * box renderer has.
 */
const patchPlaces = []
for (let index = 0; index < 150; index++) {
  const spot = findSpot({ reach: FIELD - 2, apart: 2.4, offTrack: 0, placed: patchPlaces })
  if (!spot) continue
  const roll = random()
  ground('patch', {
    x: spot[0], z: spot[1],
    width: between(1.4, 3.4), depth: between(1.2, 3),
    tint: roll < 0.42 ? WORN_TINT : roll < 0.82 ? WARM_TINT : BARE_TINT,
    yaw: between(0, 360)
  })
}

// ------------------------------------------------------------- the field's props
/**
 * Tufts, flowers, rocks and dead wood, every one under the ceiling.
 *
 * Scattered by rejection rather than on a grid: a grid is visible from the air
 * the moment there are more than about thirty of anything, and this camera is
 * from the air. The counts are set from the 45 square metres the camera shows —
 * see the note at the top of this file.
 */
const tuftPlaces = []
for (let index = 0; index < 430; index++) {
  const spot = findSpot({ reach: FIELD - 1.5, apart: 1.2, placed: tuftPlaces })
  if (!spot) continue
  const height = between(0.2, FIELD_CEILING)
  const deep = random() < 0.4
  prop('tuft', {
    x: spot[0], z: spot[1],
    size: [between(0.35, 0.7), height, between(0.25, 0.5)],
    yaw: between(0, 360),
    texture: deep ? LEAF : null,
    tint: deep ? '#b5bba5' : TUFT_GREEN
  })
  // A third get a second blade across the first, which is what turns a box seen
  // from above into a clump seen from any angle.
  if (random() < 0.28) {
    prop('tuft', {
      x: spot[0] + between(-0.22, 0.22), z: spot[1] + between(-0.22, 0.22),
      size: [between(0.3, 0.55), height * between(0.65, 0.95), between(0.2, 0.4)],
      yaw: between(0, 360), tint: TUFT_DEEP
    })
  }
}

/** Thickets: the biggest thing in the field, and what breaks it into places. */
const bushPlaces = []
for (let index = 0; index < 240; index++) {
  const spot = findSpot({ reach: FIELD - 2, apart: 3.4, placed: bushPlaces })
  if (!spot) continue
  const warm = random() < 0.4
  const height = between(0.3, FIELD_CEILING)
  prop('bush', {
    x: spot[0], z: spot[1],
    size: [between(0.7, 1.5), height, between(0.6, 1.3)],
    yaw: between(0, 360), tint: warm ? BUSH_WARM : BUSH_GREEN
  })
  if (random() < 0.55) {
    prop('bush', {
      x: spot[0] + between(-1.1, 1.1), z: spot[1] + between(-1.1, 1.1),
      size: [between(0.5, 1.1), height * between(0.65, 0.95), between(0.45, 0.9)],
      yaw: between(0, 360), tint: warm ? BUSH_GREEN : BUSH_WARM
    })
  }
}

// Flowers in threes, because one flower is a speck and three is a plant. They
// are the light end of the prop band and the only thing in the field that reads
// as a colour rather than as a shape.
const flowerPlaces = []
for (let index = 0; index < 80; index++) {
  const spot = findSpot({ reach: FIELD - 2, apart: 3.2, placed: flowerPlaces })
  if (!spot) continue
  const tint = pick([FLOWER_GOLD, FLOWER_GOLD, FLOWER_CREAM])
  for (let head = 0; head < 3; head++) {
    prop('flower', {
      x: spot[0] + between(-0.8, 0.8), z: spot[1] + between(-0.8, 0.8),
      size: [between(0.3, 0.5), between(0.28, 0.46), between(0.3, 0.5)],
      yaw: between(0, 360), tint
    })
  }
}

const rockPlaces = []
for (let index = 0; index < 110; index++) {
  const spot = findSpot({ reach: FIELD - 2, apart: 3.2, placed: rockPlaces })
  if (!spot) continue
  const height = between(0.14, FIELD_CEILING)
  prop('rock', {
    x: spot[0], z: spot[1],
    size: [between(0.5, 1.2), height, between(0.4, 1)],
    yaw: between(0, 360), texture: STONE, tiling: 1.2, tint: '#dad2c4'
  })
  // A smaller one shouldered against it, so a rock is an outcrop and not a brick.
  if (random() < 0.6) {
    prop('rock', {
      x: spot[0] + between(-1, 1), z: spot[1] + between(-1, 1),
      size: [between(0.3, 0.7), height * between(0.45, 0.8), between(0.25, 0.6)],
      yaw: between(0, 360), texture: STONE, tiling: 1.2, tint: '#f0ebdd'
    })
  }
}

const logPlaces = []
for (let index = 0; index < 30; index++) {
  const spot = findSpot({ reach: FIELD - 4, apart: 6, placed: logPlaces })
  if (!spot) continue
  const fallen = random() < 0.6
  prop('log', {
    x: spot[0], z: spot[1],
    size: fallen
      ? [between(1.8, 3.4), between(0.3, 0.44), between(0.34, 0.5)]
      : [between(0.6, 0.9), between(0.34, FIELD_CEILING), between(0.6, 0.9)],
    yaw: between(0, 360), texture: DRY, tiling: 1.5, tint: '#a79983'
  })
}

// Molehills: turned earth standing proud of the ground, so each takes a
// highlight on top and casts a real shadow. A painted patch does neither.
const molehillPlaces = []
for (let index = 0; index < 95; index++) {
  const spot = findSpot({ reach: FIELD - 2, apart: 2.6, placed: molehillPlaces })
  if (!spot) continue
  const height = between(0.12, 0.26)
  prop('molehill', {
    x: spot[0], z: spot[1],
    size: [between(0.45, 0.85), height, between(0.4, 0.75)],
    yaw: between(0, 360), texture: EARTH, tiling: 1
  })
  if (random() < 0.5) {
    prop('molehill', {
      x: spot[0] + between(-0.45, 0.45), z: spot[1] + between(-0.45, 0.45),
      size: [between(0.35, 0.6), height * between(0.5, 0.8), between(0.3, 0.55)],
      yaw: between(0, 360), texture: EARTH, tiling: 1
    })
  }
}

// ----------------------------------------------------------------- the boundary
/**
 * Where the world stops, and the only solid thing in the level besides the floor.
 *
 * Each side is ONE solid box with the hedge or the rail drawn on top as scenery.
 * Four colliders instead of two hundred: the collision grid never sees a tuft,
 * and the player is stopped by a straight line rather than by whichever shrub
 * they walked into. A gate is its own solid box, because a gap in the wall would
 * be a way out of the arena.
 *
 * THE BOUNDARY IS KNEE HIGH. It is the one place the arena could afford height
 * and deliberately does not spend it: the water beyond has to be visible from
 * inside the field, or the arena has no edge the player can see.
 */
const EDGE = FIELD + 1.5        // centre line of the bank: 46.5
const CORNER = EDGE + 1.5       // where a side has to reach to close the corner
const BANK_DEPTH = 3
const BANK_HEIGHT = 0.6
const GATE_HALF = 2.6
const GATE_WEST_Z = -32

function bank(id, { x, z, width, depth }) {
  prop(id, { x, z, size: [width, BANK_HEIGHT, depth], tint: BANK_GREEN, solid: true })
}

bank('bank-north', { x: 0, z: -EDGE, width: CORNER * 2, depth: BANK_DEPTH })
bank('bank-east', { x: EDGE, z: 0, width: BANK_DEPTH, depth: CORNER * 2 })
bank('bank-south-west', { x: (-CORNER - GATE_HALF) / 2, z: EDGE, width: CORNER - GATE_HALF, depth: BANK_DEPTH })
bank('bank-south-east', { x: (CORNER + GATE_HALF) / 2, z: EDGE, width: CORNER - GATE_HALF, depth: BANK_DEPTH })
bank('bank-west-north', { x: -EDGE, z: (-CORNER + GATE_WEST_Z - GATE_HALF) / 2, width: BANK_DEPTH, depth: CORNER + GATE_WEST_Z - GATE_HALF })
bank('bank-west-south', { x: -EDGE, z: (CORNER + GATE_WEST_Z + GATE_HALF) / 2, width: BANK_DEPTH, depth: CORNER - GATE_WEST_Z - GATE_HALF })

/**
 * A field gate: one solid leaf across the gap, with bars drawn over it.
 *
 * The solid box is declared separately from the drawn one. The gate is turned to
 * lie across the gap and the physics box is not turned with it, so the collider
 * is written in world axes and the mesh in the gate's own.
 */
function gate(id, { x, z, alongZ, width }) {
  const drawn = [width, BANK_HEIGHT + 0.4, 0.3]
  const blocked = alongZ ? [0.3, BANK_HEIGHT + 0.4, width] : drawn
  prop(id, { x, z, size: drawn, yaw: alongZ ? 90 : 0, texture: TIMBER, tiling: 1.4, tint: '#efdcbb', collider: blocked })
  for (const side of [-1, 1]) {
    prop(`${id}-post`, {
      x: x + (alongZ ? 0 : side * (width / 2 + 0.3)),
      z: z + (alongZ ? side * (width / 2 + 0.3) : 0),
      base: 0, size: [0.36, BANK_HEIGHT + 0.7, 0.36], texture: TIMBER, tiling: 1.6, tint: '#efdcbb', yaw: between(-4, 4)
    })
  }
}
gate('gate-south', { x: 0, z: EDGE, alongZ: false, width: GATE_HALF * 2 })
gate('gate-west', { x: -EDGE, z: GATE_WEST_Z, alongZ: true, width: GATE_HALF * 2 })

/** The hedge on the north and east, growing out of the bank. */
for (const side of ['north', 'east']) {
  for (let position = -CORNER; position <= CORNER; position += between(2.8, 4.4)) {
    const drift = between(-0.6, 0.6)
    const along = side === 'north' ? -EDGE + drift : EDGE + drift
    prop(`hedge-${side}`, {
      x: side === 'north' ? position : along,
      z: side === 'north' ? along : position,
      base: BANK_HEIGHT - 0.15,
      size: [between(2.8, 4.6), between(0.4, 0.65), between(2.4, 3.6)],
      yaw: between(0, 360), tint: HEDGE_GREEN
    })
  }
}

/**
 * Post and rail on the south and west, so the two halves of the boundary are
 * told apart at a glance and the player always knows which edge they are at.
 *
 * They stand ON the bank, and the whole assembly tops out at 0.9 m. The rails
 * are ONE LONG BOX each rather than one per span: a hundred and twenty rail
 * entities to draw a straight line is the bulk-placement problem this file
 * exists because of, and the join is invisible at this distance.
 */
const RAIL_TINT = '#efdcbb'
for (let position = -CORNER; position <= CORNER; position += 4.6) {
  prop('post-south', { x: position, z: EDGE, base: BANK_HEIGHT, size: [0.24, between(0.28, 0.34), 0.24], texture: TIMBER, tiling: 1.6, tint: RAIL_TINT, yaw: between(-6, 6) })
  prop('post-west', { x: -EDGE, z: position, base: BANK_HEIGHT, size: [0.24, between(0.28, 0.34), 0.24], texture: TIMBER, tiling: 1.6, tint: RAIL_TINT, yaw: between(-6, 6) })
}
prop('rail-south', { x: 0, z: EDGE, base: BANK_HEIGHT + 0.22, size: [CORNER * 2, 0.1, 0.12], texture: TIMBER, tiling: 1.6, tint: RAIL_TINT })
prop('rail-west', { x: -EDGE, z: 0, base: BANK_HEIGHT + 0.22, size: [0.12, 0.1, CORNER * 2], texture: TIMBER, tiling: 1.6, tint: RAIL_TINT })

// Long grass grown up against the bank, inside and out. This is what makes the
// boundary look like the edge of a field rather than the edge of a level.
for (let index = 0; index < 44; index++) {
  const along = between(-CORNER, CORNER)
  const distance = EDGE + BANK_DEPTH / 2 + (index % 2 ? between(0.4, 2.4) : -between(0.4, 2.4))
  const [x, z] = [[along, -distance], [along, distance], [-distance, along], [distance, along]][index % 4]
  prop('verge', {
    x, z, size: [between(1.4, 3), between(0.4, 0.8), between(0.6, 1.3)],
    yaw: between(0, 360), texture: DRY, tiling: 1.4, tint: '#cfcbaa'
  })
}

// ------------------------------------------------------------- the water ring
/**
 * The arena ends at water, which is the one cold colour in the level.
 *
 * A ring rather than a line, so the field is an island and the edge reads the
 * same whichever way the player runs into it. It starts just past the fence, so
 * that standing at the boundary the player can see what is beyond it.
 */
const WATER_IN = 48
const WATER_OUT = 74
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
 * riser of a step down faces away and cannot be seen at all. Two boxes give the
 * two faces a single box cannot: the cap takes the key light on its top and the
 * riser stands in its own shade, and that difference is the only thing that says
 * the far shore is higher than the water rather than painted on it.
 */
const LEDGE_TINT_TOP = '#e4ddcb'
const LEDGE_TINT_FACE = '#9d9484'
for (const [id, x, z, alongX] of [
  ['shore-north', 0, -WATER_OUT, true],
  ['shore-south', 0, WATER_OUT, true],
  ['shore-west', -WATER_OUT, 0, false],
  ['shore-east', WATER_OUT, 0, false]
]) {
  const length = WATER_OUT * 2 + 8
  const face = alongX ? [length, 0.9, 1.4] : [1.4, 0.9, length]
  const cap = alongX ? [length, 0.16, 5] : [5, 0.16, length]
  const step = z < 0 || x < 0 ? -1 : 1
  prop(id, { x, z, size: face, texture: STONE, tiling: 0.5, tint: LEDGE_TINT_FACE })
  prop(id, {
    x: alongX ? x : x + step * 1.8, z: alongX ? z + step * 1.8 : z,
    base: 0.9, size: cap, texture: STONE, tiling: 0.4, tint: LEDGE_TINT_TOP
  })
}

// ---------------------------------------------------------- outside the fence
/**
 * All the height in the level is out here, and that is the point of the fence:
 * past it the ground can rise, trees can stand up and a barn can block the sky,
 * because nothing the player has to shoot is ever behind any of it.
 */

/** Terraced banks rising away from the field. */
for (let index = 0; index < 18; index++) {
  const side = index % 4
  const along = between(-90, 90)
  const step = index % 3
  const out = WATER_OUT + 8 + step * 9 + between(-2, 2)
  const height = 0.9 + step * 1.1 + between(-0.3, 0.4)
  const [x, z] = side === 0 ? [along, -out] : side === 1 ? [along, out] : side === 2 ? [-out, along] : [out, along]
  prop('bank', {
    x, z, size: [between(14, 30), height, between(10, 20)],
    yaw: between(0, 360), texture: pick([GRASS, LEAF, GRASS]), tint: '#dfe8c8', tiling: 0.5
  })
}

/**
 * A tree: a trunk and three canopy masses stepped up and offset.
 *
 * Three boxes rather than one because the engine draws boxes and quads and
 * nothing else, and one box is a hedge. Stepping them gives the only thing a
 * silhouette can have here — a change of width up its height — and offsetting
 * them stops the stack reading as a pagoda.
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
for (let index = 0; index < 17; index++) {
  const angle = between(0, Math.PI * 2)
  // A ring of trees has to be a SQUARE ring, because the field is a square.
  // Dividing by the larger of the two direction cosines pushes each tree out
  // until BOTH its coordinates clear the water.
  const reach = Math.max(Math.abs(Math.cos(angle)), Math.abs(Math.sin(angle)))
  const radius = (WATER_OUT + between(6, 30)) / reach
  tree(Math.cos(angle) * radius, Math.sin(angle) * radius, between(0.85, 1.5))
}

/**
 * The barn, north-west, and the largest thing in the world.
 *
 * The roof is a stair of five boxes rather than a slope, because an entity can
 * only be turned about Y — there is no pitch and no roll in the level format. At
 * ninety metres through fog the steps read as a gable.
 */
const BARN_X = -86
const BARN_Z = -80
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

const baleSpots = [[-84, -93], [-79, -90], [-88, -88], [-83.5, -91.5], [-74, -96], [-91, -96], [-77, -101]]
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
for (let index = 0; index < 18; index++) {
  const angle = (index / 18) * Math.PI * 2 + 0.4
  const radius = between(104, 138)
  prop('hill', {
    x: Math.cos(angle) * radius, z: Math.sin(angle) * radius,
    size: [between(48, 92), between(2.2, 7), between(34, 58)],
    yaw: between(0, 360), texture: pick([GRASS, LEAF]), tint: '#d4e0c2', tiling: 0.28
  })
  if (index % 2) {
    const treeAngle = angle + between(-0.08, 0.08)
    tree(Math.cos(treeAngle) * radius * 0.94, Math.sin(treeAngle) * radius * 0.94, between(1.4, 2.4))
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
 * The key is a light ENTITY rather than `world.sun`, because only a light entity
 * casts a shadow, and the shadow is what tells the player which things stand up.
 * `world.sun` is demoted to a cool counter-fill from the opposite side, which
 * keeps shaded faces from going flat.
 *
 * It COMES FROM THE SIDE, not from behind the camera: a key down the view axis
 * lights every face the player sees and throws every shadow directly behind the
 * thing that cast it, so the scene pays for a shadow pass and shows none.
 *
 * THE KEY CASTS NO SHADOW, and that is a measurement rather than a preference.
 *
 * `range` sizes the shadow camera half either side, so a 90 m arena needs 96,
 * and the map is 1024 texels whatever the range. 96 puts 9 cm on a texel, and
 * at that size a ground lit from 57 degrees self-shadows into diagonal
 * hatching across the whole field. Narrowing the box does not help: at 47 it
 * reaches 23.5 m of a 45 m half-field and everything past it draws as if in
 * shadow, so a hard band crosses the picture wherever the player leaves the
 * box. Stopping the floor casting did not clear it either.
 *
 * The same frame, shadow on and shadow off:
 *
 *   on    edgeDensity 0.048 (cap 0.045)  value.median 0.600  spread 0.240
 *   off   edgeDensity 0.017              value.median 0.681  spread 0.252
 *
 * So the pass was spending two thirds of the frame's whole detail budget on an
 * artefact and darkening the picture while it did it. Nothing inside the fence
 * is over 0.5 m, so what it had to give back was a shadow 30 cm long.
 *
 * TURN IT BACK ON when the shadow map can cover the arena — a larger map, or a
 * shadow camera that follows the player instead of standing at the origin.
 * Both are engine changes. The direction below is left aiming across the field
 * so that switching `shadow` back to true is the only edit needed.
 *
 * Low ambient against a strong key is where value.spread comes from. Raise the
 * ambient and lit and shaded grass measure the same value.
 */
entities.push({
  id: 'key-light', type: 'light', at: [0, 40, 0],
  properties: { kind: 'directional', color: '#fff9ee', intensity: 3, direction: [-0.5, -0.84, -0.21], range: 96, shadow: false }
})

// ---------------------------------------------------------------- the player
// Last, so it is easy to find. Its y is half the kitten's own height, because
// the top of the ground is zero.
entities.push({ id: 'you', type: 'kitten', at: [0, 0.225, 0] })

// ------------------------------------------------------------------- the level
const SKY = '#a9dcf2'
const level = {
  about: [
    'A meadow on a bright day, and the arena of Kitten Survivors.',
    'GENERATED — run `node tools/make-kitten-survivors-meadow.mjs` to rebuild it; edits made here are lost on the next run.',
    'The top of the ground is y = 0. Inside the fence at 45 nothing the arena draws is taller than 0.5 m, so nothing hides the crowd.',
    'Every prop inside the fence sits in one narrow warm value band, and the creatures are the only dark things on screen.',
    'The direction every other lane matches is kitten-survivors/art/world/bible.md.',
    'Enemies are not placed here: a survivor\'s crowd arrives on a clock, not out of a level file.'
  ].join(' '),
  seed: 1,
  // `third-person`, not `3d`: `3d` puts the eye exactly at the followed entity.
  // `distance` holds the eye behind the kitten, and the arena is built for this
  // height — inside the fence nothing is taller than 0.5 m because the camera
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
    // edge. FogExp2 washes a surface by 1 - exp(-(density * metres)^2), so at
    // this density the ground is a third gone by 80 m and 97% gone by the slab's
    // corner, while at the 12 m the player actually sees it costs under 1%.
    fog: [0.0075, SKY],
    // Ambient is the shadow floor and sets the dark end of the picture.
    // Ambient plus the counter-fill IS the shadow, so the two of them set the
    // dark end of the picture. At 0.26 and 0.3 a cast shadow measured 0.60
    // against lit grass at 0.70 and the frame had a value.spread of 0.215
    // against a required 0.27 — the shadow was not dark enough to be a shadow.
    // Now that no prop is dark, this is where the whole tonal range comes from.
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
 * Two and a half thousand placements at eight lines each is a twenty thousand
 * line file nobody can scan; at one line each a diff shows which prop moved.
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
 * Read the level back and prove the three rules it is built on.
 *
 * Read back rather than checked in memory, because a level file that is not
 * valid JSON fails as an empty viewport rather than as an error anybody sees.
 */
const reread = JSON.parse(fs.readFileSync(OUT, 'utf8'))

const hex = value => [0, 2, 4].map(at => parseInt(value.slice(1 + at, 3 + at), 16) / 255)
const luminance = ([red, green, blue]) => 0.2126 * red + 0.7152 * green + 0.0722 * blue

/** Mean colour of a texture file, so a tint can be judged against what it multiplies. */
const textureColour = new Map()
async function meanColour(name) {
  if (textureColour.has(name)) return textureColour.get(name)
  const image = await readImage(`kitten-survivors/assets/${name}`)
  let red = 0, green = 0, blue = 0
  const pixels = image.width * image.height
  for (let at = 0; at < image.data.length; at += 4) {
    red += image.data[at] / 255
    green += image.data[at + 1] / 255
    blue += image.data[at + 2] / 255
  }
  const mean = [red / pixels, green / pixels, blue / pixels]
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
  const tint = mesh.tint ? hex(mesh.tint) : null
  if (!mesh.texture) return tint ? luminance(tint) : null
  const surface = await meanColour(mesh.texture)
  if (!tint) return luminance(surface)
  return luminance([surface[0] * tint[0], surface[1] * tint[1], surface[2] * tint[2]])
}

const floor = reread.entities.find(entity => entity.id === 'floor')
const floorValue = await albedo(floor.mesh)

const problems = []
const propValues = []
const decalValues = []

for (const entity of reread.entities) {
  if (entity.type !== 'meadow-prop') continue
  const [x, y, z] = entity.at
  const height = entity.mesh?.box?.[1]
  const inside = Math.abs(x) <= FIELD && Math.abs(z) <= FIELD

  // A prop inside the fence taller than the ceiling is the one mistake that
  // would not look wrong in a screenshot and would quietly cost the player a run.
  if (inside && height !== undefined && height > FIELD_CEILING + 0.001) {
    problems.push(`${entity.id} is ${height} m tall inside the fence — the ceiling is ${FIELD_CEILING} m`)
  }

  const value = await albedo(entity.mesh)
  if (value === null) {
    problems.push(`${entity.id} names neither a texture nor a tint`)
    continue
  }

  if (floorDecals.has(entity.id)) {
    decalValues.push(value)
    if (Math.abs(value - floorValue) > FLOOR_BAND + 0.001) {
      problems.push(`${entity.id} lies in the floor at ${value.toFixed(3)}, ${Math.abs(value - floorValue).toFixed(3)} from the floor's ${floorValue.toFixed(3)} — the band is ${FLOOR_BAND}`)
    }
    continue
  }

  // The band is a rule about the play field. Outside the fence a tree and a barn
  // are allowed their own value, because nothing the player must read crosses them.
  if (!inside) continue
  propValues.push(value)
  if (value < PROP_BAND[0] - 0.001 || value > PROP_BAND[1] + 0.001) {
    problems.push(`${entity.id} is value ${value.toFixed(3)} inside the fence — the prop band is ${PROP_BAND[0]} to ${PROP_BAND[1]}`)
  }
}

const byFamily = new Map()
for (const entity of reread.entities) {
  const family = String(entity.id || entity.type).replace(/-\d+$/, '')
  byFamily.set(family, (byFamily.get(family) || 0) + 1)
}
const solids = reread.entities.filter(entity => entity.collider).length
const span = list => `${Math.min(...list).toFixed(3)}–${Math.max(...list).toFixed(3)}`

console.log('')
console.log(`kitten-survivors/levels/meadow.json — ${reread.entities.length} placements, ${Math.round(text.length / 1024)} kB`)
console.log(`${solids} collide; the field is ${FIELD * 2} m across and clear to ${FIELD_CEILING} m; the slab is ${SLAB * 2} m`)
console.log('')
console.log(`floor      value ${floorValue.toFixed(3)}`)
console.log(`${decalValues.length} decals  value ${span(decalValues)}   band ${(floorValue - FLOOR_BAND).toFixed(3)}–${(floorValue + FLOOR_BAND).toFixed(3)}`)
console.log(`${propValues.length} props   value ${span(propValues)}   band ${PROP_BAND[0]}–${PROP_BAND[1]}`)
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
