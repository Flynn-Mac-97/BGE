#!/usr/bin/env node
/**
 * Restyle the meadow arena to the Brawl Stars read.
 *
 *   node agent-runs/art/restyle-meadow.mjs
 *
 * It rewrites kitten-survivors/levels/meadow.json in place, keeping the layout
 * the generator laid down — fence line, gates, ponds, barn, woods — and
 * changing only what the frame got wrong.
 *
 * The frame it starts from measured value.p95 0.61 against a floor of 0.66,
 * edgeDensity 0.063 against a cap of 0.045, and saturation pinned at 1.0. What
 * it showed was a dark saturated field under dozens of tilted tinted quads and
 * hundreds of specks. The eight Brawl Stars frames in
 * agent-runs/2026-08-31-brawl-stars/reference/ answer all three: a floor in
 * large flat blocks of one warm value with no grain, props that are chunky and
 * sparse, and a hard boundary in a cold colour so the arena ends where the eye
 * can see.
 *
 * Four changes carry it:
 *
 *   1. Every painted floor quad goes, and the ground type loses its texture.
 *      `ground-reads-as-one-surface` forbids the quads, and from nine metres up
 *      a tiled floor is a legible repeat at any scale.
 *   2. Specks go and what stays grows, with wide clumps added. Nothing a player
 *      must see is smaller than the cat's head.
 *   3. Every tint moves to the pale warm end. A saturated green cannot reach
 *      0.66 luminance at any exposure, so brightness is bought with chroma.
 *   4. A water ring is laid outside the fence. It is the one cold colour in the
 *      level and the only thing that says where the arena ends.
 *
 * It reads meadow-generated.json — the generator's own output, kept beside it —
 * and writes the level once, so it can be re-run after any change. Rebuild the
 * source with tools/make-kitten-survivors-meadow.mjs. Both belong in tools/.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')

/** The generator's own output, kept beside this so the restyle always has a clean source. */
const SOURCE = path.join(HERE, 'meadow-generated.json')
const LEVEL = path.join(ROOT, 'kitten-survivors/levels/meadow.json')

/** The fence line, and the play field it encloses. Inside, nothing stands over 0.5 m. */
const FENCE = 47
const PLAY = 45

/**
 * The palette, by the id prefix each placement carries.
 *
 * Warm and pale, drawn from what the eight world references agree on. Every
 * surface here stays under the actors in chroma: the ground is the quietest
 * thing on screen and the crowd is what the player reads.
 */
const TINTS = {
  tuft: '#7b9d43',
  flower: '#f4e6a4',
  rock: '#ded5c0',
  molehill: '#dcc9a4',
  log: '#c3a37c',
  reed: '#7fa244',
  verge: '#cfc797',
  'stone-set': '#e9e2d0',
  'stone-ring': '#dccfae',
  mown: '#dfe9b8',
  'pond-bank': '#d3c2a2',
  bank: '#c6d69a',
  'bank-north': '#c6d69a',
  'bank-east': '#c6d69a',
  'bank-south-west': '#c6d69a',
  'bank-south-east': '#c6d69a',
  'bank-west-north': '#c6d69a',
  'bank-west-south': '#c6d69a',
  'hedge-north': '#93b25f',
  'hedge-east': '#93b25f',
  canopy: '#a9c47c',
  trunk: '#c3a586',
  hill: '#c4d4b4',
  'post-south': '#d5bf9e',
  'post-west': '#d5bf9e',
  'gate-south': '#d5bf9e',
  'gate-west': '#d5bf9e',
  'gate-south-post': '#d5bf9e',
  'gate-west-post': '#d5bf9e',
  'rail-south': '#d5bf9e',
  'rail-west': '#d5bf9e',
  bale: '#f0dcab',
  'fire-stone': '#e4dcca',
  'barn-roof': '#b8a89b',
  silo: '#c8bcb0',
  'silo-cap': '#b8a89b',
  'barn-window': '#7a5f47'
}

/**
 * What is dropped whole, and why.
 *
 * Nothing else is thinned. The camera holds about 3% of the field, so the scatter
 * the generator laid down is what puts a dozen props in frame; what was wrong
 * was their size, not their number. With a flat floor and a pale keyline the
 * frame measures edgeDensity 0.008 against a cap of 0.045, so there is no edge
 * budget to save by removing them.
 */
const DROP = {
  patch: 'painted floor patches read as sheets thrown on a lawn',
  rut: 'four-metre earth slabs read as mud, not as a track — the track below replaces them',
  twig: 'below the readable size, so it can only add edges',
  'glow-worm': 'night furniture',
  fire: 'night furniture',
  'fire-stone': 'night furniture',
  'fire-glow': 'night furniture',
  'barn-glow': 'night furniture',
  'pond-glow': 'night furniture'
}

/**
 * What the boundary is cut down to, in metres.
 *
 * A 1.5 m bank with a 2 m hedge on it walled the frame off: from nine metres up
 * at sixty degrees it hid everything behind it, including the water that is the
 * only thing saying where the arena ends. A knee-high kerb blocks the same way —
 * the collider still meets the body — and shows the water over the top.
 */
const LOWER = {
  'hedge-north': 0.5,
  'hedge-east': 0.5,
  'bank-north': 0.6,
  'bank-east': 0.6,
  'bank-south-west': 0.6,
  'bank-south-east': 0.6,
  'bank-west-north': 0.6,
  'bank-west-south': 0.6
}

/**
 * The landmarks drawn in the floor, and the colour each is painted flat.
 *
 * They read from anywhere and hide nothing, which is the only kind of landmark
 * this camera can afford. Each stays close to the floor's own value: a dark one
 * reads as mud rather than as worn ground.
 */
const FLAT = {
  mown: '#c8dc86',
  'stone-ring': '#cfd591',
  'pond-bank': '#cdd18b'
}

/** Chunkier silhouettes. A prop reads by its outline, and a bigger outline reads further. */
const GROW = { tuft: 2, flower: 2.3, rock: 1.7, molehill: 1.25, log: 1.4, reed: 1.5 }

/**
 * The pale accents. Flowers and set stones are the brightest things the arena
 * draws, which is where `bright-day` gets its value.p95 — the camera looks down
 * at sixty degrees and never sees the sky.
 */
const PALE = ['#f8eec0', '#fdf7e8', '#f6e3b4']

/** The id without its trailing number, which is how a placement says what it is. */
const kindOf = id => String(id).replace(/-?\d+$/, '')

/** Nothing inside the fence is taller than 0.5 m, so half a metre hides one metre of ground. */
const CEILING = 0.5

const level = JSON.parse(fs.readFileSync(SOURCE, 'utf8'))

// ---------------------------------------------------------------- the frame

level.about = 'A meadow arena on a bright warm day, ringed by water so the field ends where the eye can see. '
  + 'The top of the ground is y = 0. Inside the fence at 47 nothing the arena draws is taller than 0.5 m, '
  + 'so nothing hides the crowd. Restyled by agent-runs/art/restyle-meadow.mjs over the layout '
  + 'tools/make-kitten-survivors-meadow.mjs laid down; running that generator again drops this. '
  + 'The direction every other lane matches is kitten-survivors/art/world/bible.md. '
  + 'Enemies are not placed here: a survivor’s crowd arrives on a clock, not out of a level file.'

// Nine metres from the cat at sixty degrees, which is the camera the art
// direction was measured for. `at` and `zoom` are the editor's own viewport,
// put back when play stops.
level.camera = {
  follow: 'you',
  mode: 'third-person',
  pitch: -1.05,
  yaw: 0,
  distance: 9,
  offsetY: 0.35,
  lerp: 0.16,
  lookAhead: 0.25,
  bounds: [-FENCE + 2, -FENCE + 2, FENCE - 2, FENCE - 2],
  fov: 55,
  at: [0, 12],
  zoom: 32
}

// Warmth comes from the sky, so the ambient is daylight rather than a blue
// bounce, and the key stays nearly white. The ambient is kept low enough that
// the key's shadows still read: at sixty degrees the camera never sees the sky,
// so light and shadow on the ground are the only source of value.spread.
level.world = {
  sky: '#a9dcf2',
  fog: [0.0075, '#e4eccd'],
  ambient: { intensity: 0.26, color: '#efe6d2' },
  sun: { direction: [0.6, -0.5, -0.62], intensity: 0.3, color: '#cfe0ee' },
  post: [
    { smaa: true },
    { bloom: { strength: 0.14, threshold: 0.85, radius: 0.5 } },
    { grade: { contrast: 1.06, saturation: 0.92 } }
  ]
}

// -------------------------------------------------------------- the entities

const dropped = {}
const kept = []

for (const entity of level.entities) {
  const kind = kindOf(entity.id)

  if (DROP[kind]) {
    dropped[kind] = (dropped[kind] || 0) + 1
    continue
  }

  if (entity.mesh?.box && GROW[kind]) {
    const [width, height, length] = entity.mesh.box
    entity.mesh.box = [
      Number((width * GROW[kind]).toFixed(2)),
      Number(Math.min(height * 1.15, CEILING).toFixed(2)),
      Number((length * GROW[kind]).toFixed(2))
    ]
    entity.at[1] = Number((entity.mesh.box[1] / 2).toFixed(3))
  }

  if (TINTS[kind] && entity.mesh) entity.mesh.tint = TINTS[kind]
  if (kind === 'flower' && entity.mesh) entity.mesh.tint = PALE[kept.length % PALE.length]

  // The boundary is cut to knee height, base kept where it was, and left flat.
  // The collider follows the mesh or the kerb would block where nothing is drawn.
  if (LOWER[kind] && entity.mesh?.box) {
    entity.mesh.box[1] = LOWER[kind]
    entity.at[1] = Number((LOWER[kind] / 2).toFixed(3))
    if (entity.collider?.box) entity.collider.box[1] = LOWER[kind]
    delete entity.mesh.texture
    delete entity.mesh.tiling
  }

  // A landmark lying in the floor carries no texture. A tiled surface at floor
  // scale is a legible repeat, which is the fault the flat floor removed.
  if (FLAT[kind] && entity.mesh) {
    delete entity.mesh.texture
    delete entity.mesh.tiling
    entity.mesh.tint = FLAT[kind]
    entity.mesh.shadow = false
    entity.mesh.outline = 0
  }

  kept.push(entity)
}

// ------------------------------------------------------- the water boundary

/**
 * The ring of water outside the fence: the one cold colour in the level, and
 * the only thing that says where the arena ends. It lies a hand above the
 * ground plane rather than in a trench, because the renderer draws boxes and a
 * trench would be a stack of them for a cue read from sixty metres away.
 */
const WATER_INNER = FENCE + 1
const WATER_OUTER = 74
const WATER_MIDDLE = (WATER_INNER + WATER_OUTER) / 2
const WATER_WIDTH = WATER_OUTER - WATER_INNER

const water = (id, at, box) => ({
  id,
  type: 'meadow-prop',
  at,
  mesh: { box, tint: '#63c2e8', shadow: false, outline: 0 }
})

const boundary = [
  water('water-north', [0, 0.03, -WATER_MIDDLE], [WATER_INNER * 2, 0.06, WATER_WIDTH]),
  water('water-south', [0, 0.03, WATER_MIDDLE], [WATER_INNER * 2, 0.06, WATER_WIDTH]),
  water('water-west', [-WATER_MIDDLE, 0.03, 0], [WATER_WIDTH, 0.06, WATER_OUTER * 2]),
  water('water-east', [WATER_MIDDLE, 0.03, 0], [WATER_WIDTH, 0.06, WATER_OUTER * 2])
]

/**
 * The spit the farmyard stands on. The barn, the silo and the bales were laid
 * down where the water ring now runs, and they are the level's one landmark
 * with real height, so the ground goes to them rather than moving them.
 */
const farmyard = {
  id: 'farmyard',
  type: 'meadow-prop',
  at: [-56, 0.06, -58],
  mesh: { box: [28, 0.12, 36], tint: '#d7d49f', shadow: false, outline: 0 }
}

/**
 * A second and third mown clearing, so a player crossing the field always has
 * one in sight. Landmarks are drawn in the floor and have no height at all —
 * the camera cannot afford a tower.
 */
const clearing = (id, at, box) => ({
  id,
  type: 'meadow-prop',
  at: [at[0], 0.025, at[1]],
  mesh: { box: [box[0], 0.05, box[1]], tint: '#c8dc86', shadow: false, outline: 0 }
})

const clearings = [
  clearing('mown-4', [26, -24], [19, 16]),
  clearing('mown-5', [-33, -36], [14, 18]),
  clearing('mown-6', [12, 33], [22, 14])
]

/**
 * The cart track, from the west gate to the south gate.
 *
 * It is a landmark drawn in the floor, so it has no height and hides nothing.
 * Narrow and pale on purpose: a wide dark one reads as mud rather than as worn
 * ground, and it would be the darkest thing on screen.
 */
const trackFrom = [-FENCE + 2, -32]
const trackTo = [0, FENCE - 2]
const TRACK_STEPS = 42

const track = Array.from({ length: TRACK_STEPS }, (unused, step) => {
  const along = step / (TRACK_STEPS - 1)
  const bend = Math.sin(along * Math.PI) * 9
  return {
    id: `track-${step + 1}`,
    type: 'meadow-prop',
    at: [
      Number((trackFrom[0] + (trackTo[0] - trackFrom[0]) * along + bend).toFixed(2)),
      0.02,
      Number((trackFrom[1] + (trackTo[1] - trackFrom[1]) * along).toFixed(2))
    ],
    mesh: { box: [2.6, 0.04, 2.6], tint: '#bfc077', shadow: false, outline: 0 },
    rotation: Number((step * 37 % 90).toFixed(1))
  }
})

/**
 * A seeded generator, so the same level in gives the same level out and a
 * change to one number does not reshuffle the field.
 */
function makeRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

const random = makeRandom(20260831)
const between = (low, high) => low + random() * (high - low)
const pick = list => list[Math.floor(random() * list.length)]

/** The greens a clump is drawn in, all darker than the floor so it reads as a shape on it. */
const CLUMP_GREENS = ['#6f9139', '#5f832c', '#7c9e44', '#557a26']

/**
 * Wide low clumps across the whole field.
 *
 * Brawl Stars breaks its floor with props that are chunky and few. Height is
 * not available here — nothing in the play field stands over 0.5 m — so the
 * chunk is bought in width: a two-metre clump at half a metre reads from
 * nine metres up and hides one metre of ground behind it.
 *
 * They come in thickets rather than evenly spread. An even scatter reads as
 * boxes dropped on a lawn; a thicket, an open lane and a stony patch read as
 * somewhere, and a player crossing the field passes landmarks instead of noise.
 */
const bushes = []

for (let thicket = 0; thicket < 44; thicket++) {
  const angle = random() * Math.PI * 2
  const distance = 5 + Math.sqrt(random()) * (PLAY - 7)
  const centre = [Math.cos(angle) * distance, Math.sin(angle) * distance]
  const stony = thicket % 4 === 0

  for (let clump = 0, clumps = 3 + Math.floor(random() * 4); clump < clumps; clump++) {
    const away = random() * Math.PI * 2
    const spread = Math.sqrt(random()) * 3.4
    const shape = stony
      ? { box: [between(1.0, 1.9), 0.3, between(0.8, 1.4)], tint: '#ded5c0', texture: 'meadow/stone.png', tiling: 0.6 }
      : { box: [between(1.5, 2.8), CEILING, between(1.4, 2.6)], tint: pick(CLUMP_GREENS) }
    bushes.push({
      id: `bush-${bushes.length + 1}`,
      type: 'meadow-prop',
      at: [
        Number((centre[0] + Math.cos(away) * spread).toFixed(2)),
        Number((shape.box[1] / 2).toFixed(3)),
        Number((centre[1] + Math.sin(away) * spread).toFixed(2))
      ],
      mesh: { ...shape, box: shape.box.map(side => Number(side.toFixed(2))) },
      rotation: Number((random() * 360).toFixed(1))
    })
  }
}

/**
 * The scatter the generator left out of the spawn circle. A player's first
 * frame was six metres of empty floor, which measured value.spread 0.004.
 */
const spawnScatter = Array.from({ length: 76 }, (unused, number) => {
  const angle = random() * Math.PI * 2
  const distance = 2.2 + Math.sqrt(random()) * 11
  const kind = number % 4
  const shape = kind === 0
    ? { box: [between(1.1, 1.8), 0.3, between(0.8, 1.3)], tint: '#ded5c0', texture: 'meadow/stone.png', tiling: 0.6 }
    : kind === 1
      ? { box: [between(0.5, 0.9), 0.44, between(0.5, 0.9)], tint: pick(PALE) }
      : { box: [between(0.8, 1.5), CEILING, between(0.7, 1.3)], tint: pick(CLUMP_GREENS) }
  return {
    id: `sprig-${number + 1}`,
    type: 'meadow-prop',
    at: [Number((Math.cos(angle) * distance).toFixed(2)), Number((shape.box[1] / 2).toFixed(3)), Number((Math.sin(angle) * distance).toFixed(2))],
    mesh: { ...shape, box: shape.box.map(side => Number(side.toFixed(2))) },
    rotation: Number((random() * 360).toFixed(1))
  }
})

// The key is the only shadow in the level, from the side and steep, so each
// shadow lies beside its prop rather than behind it.
const key = kept.find(entity => entity.id === 'key-light')
key.properties = {
  kind: 'directional',
  color: '#fff9ee',
  intensity: 2.35,
  direction: [-0.5, -0.84, -0.21],
  range: FENCE,
  shadow: true
}

// One flat colour under everything, and the level's largest single decision.
// The ground type carries no tint, so the placement is where it belongs.
const floor = kept.find(entity => entity.id === 'floor')
floor.mesh = { box: floor.mesh.box, tint: '#b2d271' }

const you = kept.find(entity => entity.id === 'you')
level.entities = [
  kept.find(entity => entity.id === 'floor'),
  ...boundary,
  farmyard,
  ...clearings,
  ...track,
  ...bushes,
  ...spawnScatter,
  ...kept.filter(entity => entity.id !== 'floor' && entity.id !== 'you'),
  you
]

// ------------------------------------------------------------------- checks

const tall = level.entities.filter(entity =>
  Math.abs(entity.at[0]) < PLAY && Math.abs(entity.at[2]) < PLAY
  && entity.type === 'meadow-prop' && (entity.mesh?.box?.[1] ?? 0) > CEILING)
if (tall.length) throw new Error(`${tall.length} props in the play field stand over ${CEILING} m: ${tall.map(entity => entity.id).join(', ')}`)

const bad = level.entities.filter(entity => /^#[0-9a-f]{6}$/i.test(entity.mesh?.tint || '#000000') === false)
if (bad.length) throw new Error(`bad tint on ${bad.map(entity => entity.id).join(', ')}`)

fs.writeFileSync(LEVEL, `${JSON.stringify(level, null, 2)}\n`)
console.log(`${level.entities.length} entities, dropped ${JSON.stringify(dropped)}`)
