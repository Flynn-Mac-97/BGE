#!/usr/bin/env node
/**
 * Build kitten-survivors/levels/meadow.json.
 *
 *   node tools/make-kitten-survivors-meadow.mjs
 *
 * WHY A TOOL AND NOT A HAND-WRITTEN FILE. The meadow is about four hundred and
 * fifty placements. `docs/design.md` lists "tilemaps and bulk placement" as a
 * known gap, and it is the gap you feel: there is no repeat, no array, no group
 * and no prefab in the level format, so a hedgerow is thirty literal JSON
 * objects and a tree is four. Scattering two hundred tufts by hand is not
 * authoring, it is transcription, and a transcribed field always ends up in
 * rows because a person cannot make up two hundred unbiased numbers.
 *
 * The level file this writes is still the truth. It is ordinary placements, the
 * editor can select and drag every one of them, and nothing at runtime knows
 * this tool exists. Re-running it overwrites whatever the editor last saved, so
 * the rule is the ordinary one for generated files: change the arena here, not
 * there, and re-run.
 *
 * Everything is seeded from one number, so the same seed gives the same meadow
 * byte for byte and a re-run is a reviewable diff rather than four hundred
 * changed lines.
 *
 * The direction this builds to is kitten-survivors/art/world/bible.md, generated
 * by the Art Direction plugin. `art.check` tests a frame of this meadow against
 * it. The two rules that shape almost every number below:
 *
 *   The top of the ground is y = 0, and a prop of height h is placed at y = h/2.
 *   Inside the fence nothing the arena draws is taller than 0.5 m.
 *
 * The second one is the whole game. The camera looks down at 60 degrees,
 * so an object of height h hides roughly 2h of ground behind it. Half a metre
 * hides one metre — less than one enemy. A fence post at 1.2 m hides two and a
 * half, which is three enemies the player never saw coming, so fence posts live
 * on the fence and the field gets tufts.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'kitten-survivors/levels/meadow.json')

// --------------------------------------------------------------- the numbers
/** Half the play field, measured to the inside face of the boundary. */
const FIELD = 45
/** The ground slab reaches well past the fence, so the outer meadow stands on grass. */
const SLAB = 170
/** Nothing is placed within this of the origin: the player starts there and must read it clean. */
const SPAWN_CLEAR = 7
/** The tallest anything inside the fence is allowed to be. See the note at the top. */
const FIELD_CEILING = 0.5

/** The surfaces the meadow is made of, and the whole of its palette. */
const GRASS = 'meadow/grass.png'
const MOWN = 'meadow/grass-mown.png'
const DRY = 'meadow/grass-dry.png'
const EARTH = 'meadow/earth.png'
const MOSS = 'meadow/moss.png'
const POND = 'meadow/pond.png'
const STONE = 'meadow/stone.png'
const TIMBER = 'meadow/timber.png'
const BARK = 'meadow/bark.png'
const LEAF = 'meadow/leaf.png'
const BARN = 'meadow/barn-board.png'
const SHINGLE = 'meadow/roof-shingle.png'
const HAY = 'meadow/hay.png'

/** The four flat colours, for the small things a texture would be wasted on. */
const TUFT_LIGHT = '#5ea84a'
const FLOWER_GOLD = '#d8c250'
const FLOWER_CREAM = '#d9d4bd'
const FLOWER_MAUVE = '#a86f9c'

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

/** A readable, stable id per family, so the Scene panel is a list and not a wall. */
function nextId(family) {
  const next = (counters.get(family) || 0) + 1
  counters.set(family, next)
  return `${family}-${next}`
}

/**
 * One box of scenery, placed by the ground it stands on rather than by its centre.
 *
 * `at` in this engine is the centre of the box, which is the right thing for the
 * engine and the wrong thing for a person building a field: every placement would
 * carry half its own height around. So this takes the ground level and does that
 * arithmetic once.
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
    // turned at all — so anything solid that is also turned has to say what it
    // blocks. The west gate is drawn across the gap and would otherwise have
    // stopped the player over a quarter of a metre of it.
    const box = collider || [width, height, depth]
    entity.collider = { box: [round(box[0]), round(box[1]), round(box[2])] }
    entity.properties = { body: 'solid' }
  }
  entities.push(entity)
  return entity
}

/** A flat piece of ground colour: a patch of moss, a dry patch, a wheel rut. */
function ground(family, { x, z, width, depth, texture, thickness = 0.06, yaw = null, tint = null }) {
  return prop(family, { x, z, base: 0, size: [width, thickness, depth], yaw, texture, tint, tiling: 1 })
}

/**
 * The ground's whole range of colour, as texture and tint together.
 *
 * A tint MULTIPLIES its texture, so it can only ever darken or warm one — a
 * patch lighter than the field has to come from a lighter texture. That is why
 * the pale end of this list is `grass-mown` and `grass-dry` rather than a tint,
 * and why every entry is written with the answer beside it.
 *
 * EVERY PATCH IS HELD CLOSE TO THE FIELD. A rotated rectangle on a floor is only
 * ever hidden by being nearly the colour of what it lies on; spread the tints out
 * and the field reads as sheets of paper thrown on a lawn.
 *
 * That is worth stating against a number, because the number does not say it.
 * `art/world/bible.md` asks for value.spread of at least 0.27, and a frame can
 * clear it two ways: from light and standing objects, which is how all eight
 * references do it, or from a patchwork of clashing floor colour, which passes
 * the same check and looks broken. Take the range from the light. The ruling
 * `ground-reads-as-one-surface` is the judged half of this and exists because
 * this generator once did the other thing.
 *
 * A tint MULTIPLIES its texture, so it can only ever darken or warm one — a
 * patch lighter than the field has to come from a lighter texture, which is why
 * the pale end is `grass-mown` and `grass-dry` rather than a tint.
 */
const GROUND_PATCHES = [
  { texture: GRASS, tint: '#eaf0d8', weight: 6 },   // the field, a touch warmer
  { texture: GRASS, tint: '#cdd8bc', weight: 6 },   // the field, a shade down
  { texture: GRASS, tint: '#c8d0d4', weight: 5 },   // where it lies damp: cooler, a shade down
  { texture: GRASS, tint: '#cec6b2', weight: 4 },   // trodden thin
  { texture: MOWN, tint: '#dce6c4', weight: 4 },    // cut: the light end of the range
  { texture: DRY, tint: '#c2c8a4', weight: 3 },     // gone over: the warm end, pulled well back
  { texture: MOSS, tint: '#e0e8d8', weight: 2 },    // the dark end, and the rarest
  { texture: EARTH, tint: '#a49a86', weight: 1 }    // bare, and only where something wore it
]
const PATCH_BAG = GROUND_PATCHES.flatMap(entry => Array(entry.weight).fill(entry))

// ------------------------------------------------------------ where things go
/** Circles nothing may be scattered into. */
const keepClear = [
  { x: 0, z: 0, radius: SPAWN_CLEAR }
]

/** The cart track, as the line it runs along. Props keep off it; ruts follow it. */
const TRACK = [
  [0, 47], [1.5, 36], [-3, 24], [-5.5, 10], [-9, -3], [-17, -14], [-28, -24], [-38, -31], [-47, -34]
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
function findSpot({ reach = FIELD - 2, apart = 2, offTrack = 2.4, tries = 40, placed = [] } = {}) {
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
// One slab, its top face at y = 0, reaching far past the fence so that the trees
// and the barn stand on grass rather than on nothing. Fog eats its far edge.
entities.push({
  id: 'floor',
  type: 'ground',
  at: [0, -0.5, 0],
  mesh: { box: [SLAB, 1, SLAB] },
  collider: { box: [SLAB, 1, SLAB] }
})

// --------------------------------------------------------------- the pond
const POND_X = 23
const POND_Z = 14
const POND_R = 7
keepClear.push({ x: POND_X, z: POND_Z, radius: POND_R + 2.4 })

// Water, then a ring of mud around it. The water sits a centimetre lower than
// the mud so the bank reads as a bank rather than as a painted circle.
prop('pond', { x: POND_X, z: POND_Z, base: -0.04, size: [POND_R * 1.9, 0.08, POND_R * 1.6], yaw: 12, texture: POND, tiling: 0.35 })
prop('pond', { x: POND_X - 3.4, z: POND_Z + 2.2, base: -0.03, size: [6.5, 0.08, 5.4], yaw: -24, texture: POND, tiling: 0.35 })
for (let index = 0; index < 9; index++) {
  const angle = (index / 9) * Math.PI * 2 + 0.3
  ground('pond-bank', {
    x: POND_X + Math.cos(angle) * (POND_R + between(0.6, 1.8)),
    z: POND_Z + Math.sin(angle) * (POND_R * 0.85 + between(0.6, 1.8)),
    width: between(3.5, 6.5), depth: between(2.6, 4.6), texture: EARTH, tint: '#a49a86', thickness: 0.05,
    yaw: between(0, 360)
  })
}
// Reeds: the one place the field is allowed a vertical, and they stop at 0.5 m
// like everything else in it.
for (let index = 0; index < 14; index++) {
  const angle = between(0, Math.PI * 2)
  const radius = POND_R * between(0.95, 1.15)
  prop('reed', {
    x: POND_X + Math.cos(angle) * radius,
    z: POND_Z + Math.sin(angle) * radius * 0.85,
    size: [between(0.25, 0.5), between(0.34, FIELD_CEILING), between(0.14, 0.26)],
    yaw: between(0, 360), texture: LEAF, tiling: 2
  })
}

// -------------------------------------------------------- the flat landmarks
/**
 * Two places the player can name, drawn ENTIRELY IN THE FLOOR.
 *
 * A survivor's player has to know where they are while looking at a hundred
 * enemies, and the usual answer — a tower, a statue, a big rock — is the one
 * thing this camera cannot afford, because anything tall enough to see across
 * the field is tall enough to hide the crowd behind it. So the landmarks here
 * have no height at all: a mown clearing and a ring of set stones. They read
 * from anywhere, they are unmistakable, and they hide nothing.
 */
const RING_X = -19
const RING_Z = -21
keepClear.push({ x: RING_X, z: RING_Z, radius: 7 })
ground('stone-ring', { x: RING_X, z: RING_Z, width: 12.5, depth: 12, texture: EARTH, tint: '#a49a86', thickness: 0.05, yaw: 18 })
for (let index = 0; index < 9; index++) {
  const angle = (index / 9) * Math.PI * 2
  prop('stone-set', {
    x: RING_X + Math.cos(angle) * 5.1,
    z: RING_Z + Math.sin(angle) * 5.1,
    size: [between(1.5, 2.3), 0.16, between(1.2, 1.9)],
    yaw: (angle * 180) / Math.PI + between(-14, 14), texture: STONE, tiling: 0.7
  })
}

const MOWN_X = -23
const MOWN_Z = 25
keepClear.push({ x: MOWN_X, z: MOWN_Z, radius: 8.5 })
ground('mown', { x: MOWN_X, z: MOWN_Z, width: 17, depth: 15.5, texture: MOWN, tint: '#dce6c4', thickness: 0.05, yaw: -8 })
ground('mown', { x: MOWN_X + 6.5, z: MOWN_Z - 5.5, width: 9, depth: 8, texture: MOWN, tint: '#dce6c4', thickness: 0.05, yaw: 24 })
ground('mown', { x: MOWN_X - 6, z: MOWN_Z + 5, width: 8, depth: 7.5, texture: MOWN, tint: '#dce6c4', thickness: 0.05, yaw: 40 })

// ------------------------------------------------------------ the cart track
// Ruts, laid along the track as overlapping slabs turned to follow it. Two per
// segment and slightly different widths, so the track wanders like a used one.
for (let index = 0; index < TRACK.length - 1; index++) {
  const [ax, az] = TRACK[index]
  const [bx, bz] = TRACK[index + 1]
  const steps = Math.max(2, Math.round(Math.hypot(bx - ax, bz - az) / 4.5))
  for (let step = 0; step < steps; step++) {
    const along = (step + 0.5) / steps
    const x = ax + (bx - ax) * along
    const z = az + (bz - az) * along
    const heading = (Math.atan2(bx - ax, bz - az) * 180) / Math.PI
    ground('rut', {
      x, z, width: between(3.2, 4.4), depth: Math.hypot(bx - ax, bz - az) / steps + 1.6,
      texture: EARTH, thickness: 0.05, yaw: heading + between(-5, 5)
    })
  }
}

// ---------------------------------------------------------- the field's colour
/**
 * Forty-odd flat patches, and the reason the arena is not one green rectangle.
 *
 * They are 5 to 8 centimetres thick, which at this camera hides nothing at all,
 * and they carry every change of colour the field has: cut grass, straw where it
 * has gone over, moss in the damp, bare earth where it is walked. This is the
 * cheap half of "ground with height in it" — the expensive half, real relief,
 * would hide enemies, so it lives outside the fence instead.
 */
const patchPlaces = []
for (let index = 0; index < 54; index++) {
  // `apart` is small on purpose: patches are meant to OVERLAP. A rectangle whose
  // whole outline is visible reads as a rectangle, and two overlapping ones read
  // as a shape. This is the only tool a box-and-quad renderer gives you for an
  // irregular edge, so it is used hard.
  const spot = findSpot({ reach: FIELD - 3, apart: 3.4, offTrack: 0, placed: patchPlaces })
  if (!spot) continue
  const chosen = pick(PATCH_BAG)
  ground('patch', {
    x: spot[0], z: spot[1],
    width: between(3.5, 9.5), depth: between(3, 8),
    texture: chosen.texture, tint: chosen.tint,
    thickness: between(0.04, 0.09), yaw: between(0, 360)
  })
}

// ------------------------------------------------------------- the field's props
/**
 * Tufts, flowers, rocks and dead wood. Every one of them under half a metre.
 *
 * Scattered by rejection rather than by a grid: a grid is visible from the air
 * the moment there are more than about thirty of anything, and this camera is
 * from the air.
 */
const tuftPlaces = []
for (let index = 0; index < 132; index++) {
  const spot = findSpot({ reach: FIELD - 1.5, apart: 2.1, placed: tuftPlaces })
  if (!spot) continue
  const height = between(0.26, FIELD_CEILING)
  const dark = random() < 0.62
  prop('tuft', {
    x: spot[0], z: spot[1],
    size: [between(0.4, 0.8), height, between(0.16, 0.34)],
    yaw: between(0, 360),
    texture: dark ? LEAF : null,
    tint: dark ? null : TUFT_LIGHT,
    tiling: dark ? 2.5 : null
  })
  // A third of them get a second blade across the first, which is what turns a
  // box seen from above into a clump seen from any angle.
  if (random() < 0.34) {
    prop('tuft', {
      x: spot[0] + between(-0.16, 0.16), z: spot[1] + between(-0.16, 0.16),
      size: [between(0.3, 0.6), height * between(0.6, 0.9), between(0.14, 0.28)],
      yaw: between(0, 360),
      texture: dark ? null : LEAF,
      tint: dark ? TUFT_LIGHT : null,
      tiling: dark ? null : 2.5
    })
  }
}

// Flowers in threes, because one flower is a speck and three is a plant.
const flowerPlaces = []
for (let index = 0; index < 26; index++) {
  const spot = findSpot({ reach: FIELD - 3, apart: 4.2, placed: flowerPlaces })
  if (!spot) continue
  const tint = pick([FLOWER_GOLD, FLOWER_GOLD, FLOWER_CREAM, FLOWER_MAUVE])
  for (let head = 0; head < 3; head++) {
    prop('flower', {
      x: spot[0] + between(-0.7, 0.7), z: spot[1] + between(-0.7, 0.7),
      size: [between(0.16, 0.26), between(0.24, 0.4), between(0.16, 0.26)],
      yaw: between(0, 360), tint
    })
  }
}

const rockPlaces = []
for (let index = 0; index < 26; index++) {
  const spot = findSpot({ reach: FIELD - 2, apart: 5, placed: rockPlaces })
  if (!spot) continue
  const height = between(0.2, FIELD_CEILING)
  prop('rock', {
    x: spot[0], z: spot[1],
    size: [between(0.6, 1.6), height, between(0.5, 1.4)],
    yaw: between(0, 360), texture: STONE, tiling: 1.2
  })
  // A smaller one shouldered against it, so a rock is an outcrop and not a brick.
  if (random() < 0.6) {
    prop('rock', {
      x: spot[0] + between(-1, 1), z: spot[1] + between(-1, 1),
      size: [between(0.35, 0.8), height * between(0.4, 0.75), between(0.3, 0.7)],
      yaw: between(0, 360), texture: STONE, tiling: 1.2
    })
  }
}

const logPlaces = []
for (let index = 0; index < 11; index++) {
  const spot = findSpot({ reach: FIELD - 4, apart: 9, placed: logPlaces })
  if (!spot) continue
  const fallen = random() < 0.6
  prop('log', {
    x: spot[0], z: spot[1],
    size: fallen ? [between(1.8, 3.4), between(0.3, 0.44), between(0.34, 0.5)] : [between(0.6, 0.9), between(0.34, FIELD_CEILING), between(0.6, 0.9)],
    yaw: between(0, 360), texture: BARK, tiling: 1.5
  })
}

// ----------------------------------------------------------------- the boundary
/**
 * Where the world stops, and the only solid thing in the level besides the floor.
 *
 * Each side is ONE solid box with the hedge or the fence drawn on top of it as
 * scenery. Four colliders instead of two hundred: the collision grid never sees
 * a tuft, and the player is stopped by a straight line rather than by whichever
 * shrub they happened to walk into. The gates are the exception — a gap in the
 * wall would be a way out of the arena, so a gate is its own solid box.
 *
 * The boundary is allowed to be tall, and is the only thing that is. It is at the
 * edge of the field, so what it hides is outside the field.
 */
const EDGE = FIELD + 1.5        // centre line of the bank: 46.5
const CORNER = EDGE + 1.5       // where a side has to reach to close the corner
const BANK_DEPTH = 3
const BANK_HEIGHT = 1.5
const GATE_HALF = 2.6
const GATE_WEST_Z = -32

/**
 * The bank. A field in this country is bounded by an earth bank with something
 * growing out of it, and that is worth copying exactly: it is solid, it is
 * grass so it belongs to the field rather than being a wall dropped on it, and
 * at a metre and a half it stops the player without being the tallest thing in
 * the picture.
 */
function bank(id, { x, z, width, depth }) {
  prop(id, { x, z, size: [width, BANK_HEIGHT, depth], texture: GRASS, tiling: 0.7, solid: true })
}

// North and south run in x, east and west in z, and each reaches past the corner
// so the four of them close. The south and west are broken by a gate.
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
 * is written out in world axes and the mesh is written in the gate's own.
 */
function gate(id, { x, z, alongZ, width }) {
  const drawn = [width, BANK_HEIGHT, 0.3]
  const blocked = alongZ ? [0.3, BANK_HEIGHT, width] : drawn
  prop(id, { x, z, size: drawn, yaw: alongZ ? 90 : 0, texture: TIMBER, tiling: 1.4, collider: blocked })
  for (let bar = 0; bar < 3; bar++) {
    prop(id, { x, z, base: 0.3 + bar * 0.42, size: [width * 0.94, 0.14, 0.34], yaw: alongZ ? 90 : 0, texture: TIMBER, tiling: 1.4 })
  }
  for (const side of [-1, 1]) {
    prop(`${id}-post`, {
      x: x + (alongZ ? 0 : side * (width / 2 + 0.3)),
      z: z + (alongZ ? side * (width / 2 + 0.3) : 0),
      base: 0, size: [0.36, 1.9, 0.36], texture: TIMBER, tiling: 1.6, yaw: between(-4, 4)
    })
  }
}
gate('gate-south', { x: 0, z: EDGE, alongZ: false, width: GATE_HALF * 2 })
gate('gate-west', { x: -EDGE, z: GATE_WEST_Z, alongZ: true, width: GATE_HALF * 2 })

/**
 * The hedge, growing out of the bank on the north and east. Chunky overlapping
 * masses rather than a green wall, because a wall reads as a wall and a hedge
 * has to read as something that grew.
 */
for (const side of ['north', 'east']) {
  for (let position = -CORNER; position <= CORNER; position += between(2.8, 4.4)) {
    const drift = between(-0.6, 0.6)
    const along = side === 'north' ? -EDGE + drift : EDGE + drift
    prop(`hedge-${side}`, {
      x: side === 'north' ? position : along,
      z: side === 'north' ? along : position,
      base: BANK_HEIGHT - 0.3,
      size: [between(2.8, 4.6), between(1.5, 2.4), between(2.4, 3.6)],
      yaw: between(0, 360), texture: LEAF, tiling: 0.8
    })
  }
}

/**
 * Post and rail on the south and west, so the two halves of the boundary are
 * told apart at a glance and the player always knows which edge they are at.
 *
 * The rails are ONE LONG BOX each rather than one per span. A hundred and twenty
 * rail entities to draw a straight line is exactly the bulk-placement problem
 * this file exists because of, and the join between two rails is invisible at
 * this distance anyway.
 */
for (let position = -CORNER; position <= CORNER; position += 4.6) {
  prop('post-south', { x: position, z: EDGE, base: BANK_HEIGHT, size: [0.26, between(1.2, 1.4), 0.26], texture: TIMBER, tiling: 1.6, yaw: between(-6, 6) })
  prop('post-west', { x: -EDGE, z: position, base: BANK_HEIGHT, size: [0.26, between(1.2, 1.4), 0.26], texture: TIMBER, tiling: 1.6, yaw: between(-6, 6) })
}
for (const height of [0.5, 1]) {
  prop('rail-south', { x: 0, z: EDGE, base: BANK_HEIGHT + height, size: [CORNER * 2, 0.15, 0.13], texture: TIMBER, tiling: 1.6 })
  prop('rail-west', { x: -EDGE, z: 0, base: BANK_HEIGHT + height, size: [0.13, 0.15, CORNER * 2], texture: TIMBER, tiling: 1.6 })
}

// Long grass grown up against the bank, inside and out. This is what makes the
// boundary look like the edge of a field rather than the edge of a level.
for (let index = 0; index < 36; index++) {
  const along = between(-CORNER, CORNER)
  // Half of them grow on the field's side of the bank and half on the far side.
  const distance = EDGE + BANK_DEPTH / 2 + (index % 2 ? between(0.4, 2.4) : -between(0.4, 2.4))
  const [x, z] = [[along, -distance], [along, distance], [-distance, along], [distance, along]][index % 4]
  prop('verge', {
    x, z, size: [between(1.4, 3), between(0.5, 1.2), between(0.6, 1.3)],
    yaw: between(0, 360), texture: DRY, tiling: 1.4
  })
}

// ---------------------------------------------------------- outside the fence
/**
 * All the height in the level is out here, and that is the whole point of the
 * fence: past it the ground can rise, trees can stand up and a barn can block
 * the sky, because nothing the player has to shoot is ever behind any of it.
 */

/** Terraced banks rising away from the field, three steps to about three metres. */
for (let index = 0; index < 18; index++) {
  const side = index % 4
  const along = between(-90, 90)
  const step = index % 3
  const out = EDGE + 8 + step * 9 + between(-2, 2)
  const height = 0.9 + step * 1.1 + between(-0.3, 0.4)
  const [x, z] = side === 0 ? [along, -out] : side === 1 ? [along, out] : side === 2 ? [-out, along] : [out, along]
  prop('bank', {
    x, z, size: [between(14, 30), height, between(10, 20)],
    yaw: between(0, 360), texture: pick([GRASS, LEAF, GRASS]), tint: '#7c8a72', tiling: 0.5
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
  prop('trunk', { x, z, size: [0.7 * scale, trunkHeight, 0.7 * scale], yaw: between(0, 360), texture: BARK, tiling: 1.2 })
  let base = trunkHeight * 0.72
  let width = 4.6 * scale
  for (let layer = 0; layer < 3; layer++) {
    const height = between(1.5, 2.3) * scale
    prop('canopy', {
      x: x + between(-0.5, 0.5) * scale, z: z + between(-0.5, 0.5) * scale,
      base, size: [width, height, width * between(0.82, 1.12)],
      yaw: between(0, 360), texture: LEAF, tint: '#9aa894', tiling: 0.55
    })
    base += height * 0.78
    width *= between(0.62, 0.78)
  }
}
for (let index = 0; index < 15; index++) {
  const angle = between(0, Math.PI * 2)
  // A ring of trees has to be a SQUARE ring, because the field is a square. A
  // circular one at radius 57 puts a tree at (-45, 35), which is well outside a
  // circle of that radius and comfortably inside the fence — a five metre canopy
  // standing in the arena, hiding twelve metres of ground. Dividing by the larger
  // of the two direction cosines pushes each tree out until BOTH its coordinates
  // clear the boundary.
  const reach = Math.max(Math.abs(Math.cos(angle)), Math.abs(Math.sin(angle)))
  const radius = (CORNER + between(6, 30)) / reach
  tree(Math.cos(angle) * radius, Math.sin(angle) * radius, between(0.85, 1.5))
}

/**
 * The barn, north-west, and the only saturated red in the world.
 *
 * The roof is a stair of five boxes rather than a slope, because an entity can
 * only be turned about Y — there is no pitch and no roll anywhere in the level
 * format — so a pitched roof has to be built out of steps. At sixty metres
 * through fog the steps read as a gable, which is the honest reason this works.
 */
const BARN_X = -58
const BARN_Z = -50
prop('barn', { x: BARN_X, z: BARN_Z, size: [16, 7.5, 11], yaw: 14, texture: BARN, tiling: 0.55 })
prop('barn-door', { x: BARN_X + 4.6, z: BARN_Z + 5.2, size: [4.4, 5.2, 0.5], yaw: 14, texture: TIMBER, tiling: 0.5 })
prop('barn-window', { x: BARN_X - 3.4, z: BARN_Z + 5.4, base: 3.4, size: [2.2, 1.8, 0.35], yaw: 14, tint: '#ffc978', material: 'basic' })
for (let step = 0; step < 5; step++) {
  const inset = step * 1.5
  prop('barn-roof', {
    x: BARN_X, z: BARN_Z, base: 7.5 + step * 0.66,
    size: [16.8 - inset * 0.2, 0.7, 11.6 - inset * 2], yaw: 14, texture: SHINGLE, tiling: 1.1
  })
}
prop('silo', { x: BARN_X + 11.5, z: BARN_Z - 2, size: [5, 12, 5], yaw: 22, texture: SHINGLE, tiling: 0.8 })
prop('silo-cap', { x: BARN_X + 11.5, z: BARN_Z - 2, base: 12, size: [5.6, 1.1, 5.6], yaw: 22, texture: SHINGLE, tiling: 1.2 })

// Bales, stacked and scattered around the yard, and the warmest thing out here
// after the barn itself.
const baleSpots = [[-56, -63], [-51, -60], [-60, -58], [-55.5, -61.5], [-46, -66], [-63, -66], [-49, -71]]
baleSpots.forEach(([x, z], index) => {
  prop('bale', { x, z, base: index === 3 ? 1.5 : 0, size: [2.4, 1.5, 1.7], yaw: between(0, 360), texture: HAY, tiling: 0.9 })
})

// A far ridge of hills, on the horizon and mostly eaten by fog. They exist so
// the sky does not meet the ground in a straight line all the way round.
for (let index = 0; index < 16; index++) {
  const angle = (index / 16) * Math.PI * 2 + 0.4
  const radius = between(104, 138)
  // LOW and WIDE. The first pass made them six to seventeen metres tall and they
  // stood above the horizon line as a ring of flat-topped blocks — a dam, not a
  // ridge. Distant land wants to sit ON the horizon: two to seven metres at a
  // hundred and twenty is a shape you read and never look at again.
  prop('hill', {
    x: Math.cos(angle) * radius, z: Math.sin(angle) * radius,
    size: [between(48, 92), between(2.2, 7), between(34, 58)],
    yaw: between(0, 360), texture: pick([GRASS, LEAF]), tint: '#5a6668', tiling: 0.28
  })
  // A few dark trees on the ridge, which is what breaks a straight top edge into
  // a landscape.
  if (index % 2) {
    const treeAngle = angle + between(-0.08, 0.08)
    tree(Math.cos(treeAngle) * radius * 0.94, Math.sin(treeAngle) * radius * 0.94, between(1.4, 2.4))
  }
}

// The campfire, just outside the south gate: the one warm pool of light the
// player can walk towards, and the reason the southern fence has a colour.
const FIRE_X = 7
const FIRE_Z = EDGE + 6
for (let index = 0; index < 5; index++) {
  const angle = (index / 5) * Math.PI * 2
  prop('fire-stone', {
    x: FIRE_X + Math.cos(angle) * 1.1, z: FIRE_Z + Math.sin(angle) * 1.1,
    size: [between(0.5, 0.8), between(0.3, 0.45), between(0.45, 0.7)],
    yaw: between(0, 360), texture: STONE, tiling: 1.2
  })
}
prop('fire', { x: FIRE_X, z: FIRE_Z, base: 0.1, size: [0.9, 0.8, 0.9], yaw: 24, tint: '#ff8a34', material: 'additive', opacity: 0.85 })
prop('fire', { x: FIRE_X, z: FIRE_Z, base: 0.5, size: [0.55, 0.7, 0.55], yaw: -18, tint: '#ffd06a', material: 'additive', opacity: 0.9 })

// Glow-worms by the pond: a small warm light inside the field that costs no
// height at all, which is the only kind of light the field can have.
for (let index = 0; index < 7; index++) {
  prop('glow-worm', {
    x: POND_X - 6 + between(-2.2, 2.2), z: POND_Z - 5 + between(-2.2, 2.2),
    base: between(0.05, 0.3), size: [0.12, 0.12, 0.12], tint: '#9cf07a', material: 'additive'
  })
}

// -------------------------------------------------------------------- the light
/**
 * One key, one fill, one ambient, and three small warm sources.
 *
 * BRIGHT WARM DAY. `art/world/bible.md` sets four measured bounds this block has
 * to clear: value.p95 at least 0.66, value.median at least 0.43, value.spread at
 * least 0.27 and warmShare at least 0.35. Eight references agree on all four and
 * none of them is dark. Run `art.check` after changing anything here.
 *
 * The key sits at about sixty degrees, which is a derived ruling and not a look:
 * a sun a few degrees off the horizon throws shadows twenty metres long, and
 * twenty metres of shadow across a field full of enemies is twenty metres the
 * player cannot read. At thirty-four degrees the hedge and trees past the east
 * fence raked their shadows metres into the play field.
 *
 * The key is a light ENTITY rather than `world.sun`, because only a light entity
 * can cast a shadow, and the shadow is what tells the player which things are
 * standing up. `world.sun` is then demoted to a cool counter-fill from the
 * opposite side, which keeps the shaded faces from going flat and puts a cold
 * edge on everything the warm light misses.
 *
 * `range` on a directional light is not a falloff — it sizes the shadow camera,
 * half of it either side. 96 covers the field at about nine centimetres per
 * shadow texel: a soft blob under a tuft and a real shape under a tree.
 *
 * THE KEY COMES FROM THE SIDE, NOT FROM BEHIND THE CAMERA. It was first aimed
 * away down the view axis, which lights every face the player sees and throws
 * every shadow directly behind the thing that cast it — so the scene rendered a
 * full extra shadow pass every frame and not one shadow was visible. Swinging it
 * round to come from the right lays each shadow across the ground beside its
 * prop, which is the only thing that tells the player a tuft is standing up and
 * an earth patch is lying flat, and is what puts the cat's own shadow beside it
 * so it reads as being ON the field rather than drawn over it.
 */
// Centred over the field: a directional light's shadow box sits round its
// entity, so from [0, 40, 0] the ±48 m box covers the whole arena — parked
// over a corner it clipped the far half and those shadows simply vanished.
entities.push({
  id: 'key-light', type: 'light', at: [0, 40, 0],
  properties: { kind: 'directional', color: '#fff6e6', intensity: 2.85, direction: [-0.47, -0.87, -0.17], range: 96, shadow: true }
})
entities.push({
  id: 'barn-glow', type: 'light', at: [BARN_X - 3.4, 4.2, BARN_Z + 7],
  properties: { kind: 'point', color: '#ffb44e', intensity: 2.1, range: 19 }
})
entities.push({
  id: 'fire-glow', type: 'light', at: [FIRE_X, 1.1, FIRE_Z],
  properties: { kind: 'point', color: '#ff8f3c', intensity: 3.2, range: 16 }
})
entities.push({
  id: 'pond-glow', type: 'light', at: [POND_X - 6, 0.8, POND_Z - 5],
  properties: { kind: 'point', color: '#8fe86a', intensity: 1.6, range: 9 }
})

// ---------------------------------------------------------------- the player
// Last, so it is the last thing in the file and easy to find. Its y is half the
// kitten's own height, because the top of the ground is zero.
entities.push({ id: 'you', type: 'kitten', at: [0, 0.225, 0] })

// ------------------------------------------------------------------- the level
const level = {
  about: [
    'A meadow on a bright day, and the arena of Kitten Survivors.',
    'GENERATED — run `node tools/make-kitten-survivors-meadow.mjs` to rebuild it; edits made here are lost on the next run.',
    'The top of the ground is y = 0. Inside the fence at 46 nothing the arena draws is taller than 0.5 m, so nothing hides the crowd.',
    'The direction every other lane matches is kitten-survivors/art/world/bible.md.',
    'Enemies are not placed here: a survivor\'s crowd arrives on a clock, not out of a level file.'
  ].join(' '),
  seed: 1,
  // `third-person`, not `3d`: `3d` puts the eye exactly at the followed entity,
  // so pressing play left you at grass level looking down at your own back.
  // `distance` is what holds the eye behind the kitten, and the arena is built
  // for this height — inside the fence nothing is taller than 0.5 m because the
  // camera looks down at 60 degrees from fourteen metres back. The horde plugin
  // measures its spawn ring from this rule, so these numbers ARE the game's
  // spawn distance: move the camera and the ring moves with it.
  camera: {
    follow: 'you',
    mode: 'third-person',
    pitch: -1.05,
    yaw: 0,
    distance: 14,
    offsetY: 0.15,
    lerp: 0.18,
    lookAhead: 0.22,
    // The whole field, so the follow only lets go at the fence itself.
    bounds: [-46.5, -46.5, 46.5, 46.5],
    fov: 50,
    at: [0, 12],
    zoom: 32
  },
  world: {
    // Flat sky, no panorama. A painted dusk panorama was the darkest thing in
    // frame and a phone sees the top third of it; one bright colour costs
    // nothing and never competes with the field.
    sky: '#8ecae6',
    // Thin and pale. At 0.011 and violet the fog washed the far field out to
    // half its value by 76 m, on a field 90 m across. This keeps the depth cue
    // and stops the edges going dark.
    fog: [0.0006, '#cfe4bd'],
    // Ambient is the shadow floor, so it sets the dark end of the picture. At
    // 0.85 the field measured value.spread 0.191 against a required 0.27: lit
    // and shaded grass came out the same value and the frame had no range at
    // all. Low ambient against a strong key is where the range comes from.
    ambient: { intensity: 0.48, color: '#c3d9ea' },
    sun: { direction: [0.55, -0.45, 0.7], intensity: 0.3, color: '#bcd4ea' },
    // Bloom is set to touch only what is genuinely bright — the fire, the barn
    // window, the glow-worms. At threshold 0.78 it caught the lit grass as well
    // and the whole field came back orange, which is the failure mode of every
    // bloom anyone has ever regretted: it does not look like light, it looks
    // like the picture is broken.
    post: [
      { smaa: true },
      // Threshold above the lit grass. The field is bright now, so 0.95 caught
      // the ground itself and the whole frame came back milky.
      { bloom: { strength: 0.1, threshold: 0.995, radius: 0.4 } },
      // NO TINT. A warm white tint multiplies every pixel toward the tint and
      // took the field's saturation from 0.66 to 0.33 — the wash read as fog and
      // was not fog. Grade contrast only.
      { grade: { contrast: 1.1, saturation: 0.98 } }
    ]
  },
  entities
}

// ------------------------------------------------------------------- writing
/**
 * One entity per line.
 *
 * Four hundred and fifty placements at eight lines each is a four thousand line
 * file nobody can scan; at one line each it is four hundred and fifty lines and
 * a diff shows which prop moved.
 */
function write(level) {
  const head = JSON.stringify({ about: level.about, seed: level.seed, camera: level.camera, world: level.world }, null, 2)
  const lines = level.entities.map(entity => `    ${JSON.stringify(entity)}`)
  return `${head.slice(0, -2)},\n  "entities": [\n${lines.join(',\n')}\n  ]\n}\n`
}

const text = write(level)
fs.writeFileSync(OUT, text)

// Read it back and parse it, because a level file that is not valid JSON fails
// as an empty viewport rather than as an error anybody can see.
const reread = JSON.parse(fs.readFileSync(OUT, 'utf8'))
const byFamily = new Map()
for (const entity of reread.entities) {
  const family = String(entity.id || entity.type).replace(/-\d+$/, '')
  byFamily.set(family, (byFamily.get(family) || 0) + 1)
}

// Prove the rule this file is built on, rather than claiming it. A prop inside
// the fence taller than the ceiling is the one mistake that would not look wrong
// in a screenshot and would quietly cost the player a run.
const tooTall = reread.entities.filter(entity => {
  const [x, y, z] = entity.at
  if (Math.abs(x) > FIELD || Math.abs(z) > FIELD) return false
  const height = entity.mesh?.box?.[1]
  return height !== undefined && entity.type === 'meadow-prop' && height > FIELD_CEILING + 0.001
})

const solids = reread.entities.filter(entity => entity.collider).length
console.log('')
console.log(`kitten-survivors/levels/meadow.json — ${reread.entities.length} placements, ${Math.round(text.length / 1024)} kB`)
console.log(`${solids} of them collide; the field is ${FIELD * 2} m across and clear to ${FIELD_CEILING} m`)
console.log('')
for (const [family, count] of [...byFamily].sort((a, b) => b[1] - a[1])) {
  console.log(`${family.padEnd(20)}${String(count).padStart(4)}`)
}
console.log('')
if (tooTall.length) {
  for (const entity of tooTall) {
    console.error(`[make-kitten-survivors-meadow] ${entity.id} is ${entity.mesh.box[1]} m tall inside the fence — the ceiling is ${FIELD_CEILING} m`)
  }
  process.exitCode = 1
}
