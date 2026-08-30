#!/usr/bin/env node
/**
 * Generate the de_dust2 texture set.
 *
 *   node tools/make-counter-strike-textures.mjs
 *
 * Counter-Strike's dust2 is sun-bleached Moroccan sandstone: warm ochre and tan,
 * dust haze, and the only saturated colour on the whole map coming from the
 * blue-green doors, the blue tarps and the red-brown crates. Almost every value
 * here sits between #8a7454 and #d9c49a on purpose.
 *
 * These are painted rather than photographed, and painted means STRUCTURE. Every
 * texture lays down a base colour, varies it with a few octaves of value noise so
 * large areas are unevenly lit, then draws the actual geometry of the material —
 * courses of blocks, plank edges, panel rebates — with a darkened recess and a
 * light catch along the top edge of each element. Per-pixel grain goes on last
 * and stays small. Grain first is what makes a texture read as fuzz.
 *
 * Everything is generated on a torus: coordinates wrap modulo the size, block
 * grids divide it, and every sinusoid completes a whole number of cycles. A
 * texture that seams is worse than a flat colour, because the seam draws a grid
 * across the whole map. The tool checks its own work — see `seamRatio` — and says
 * so on the console rather than leaving a bad tile to be found in the viewport.
 *
 * Not everything here tiles, and the ones that do not say so. A door is a single
 * object seen once and a sky is one image wrapped round the world; neither is a
 * material, and drawing them as if they were is what gives you a wall of doors.
 * Those carry `wrap: ''` in the list below, are authored at the proportion of the
 * surface they go on, and MUST be declared in the level as `tiling: [1, 1]` —
 * see the note above TEXTURES, which spells out why the bare `tiling: 1` those
 * placements have today is not the same thing.
 *
 * Every stone, plaster and sand surface finishes with `weather`. Painted
 * textures always come out cleaner, newer and more colourful than the thing they
 * are of, because a painter reaches for the colour they know a brick is rather
 * than the nearly grey one the sun has left, and because a texture drawn as a
 * flat sample has no idea where the ground is. That one pass is what turns a set
 * of samples into a place.
 *
 * This is a build tool and not game code, so `Math.random` would be allowed here.
 * It still uses its own seeded generator, because a texture that changes every
 * time it is generated turns a re-run into a hundred-kilobyte diff nobody can
 * review. The seed comes from the texture's own name, so adding a texture leaves
 * every other file byte-identical.
 *
 * PNG is written by hand with node's own zlib, following tools/make-sprites.mjs,
 * so the project keeps zero build dependencies. That file's encoder is copied
 * rather than imported because it is a script that writes sprites the moment it
 * is loaded.
 */
import zlib from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// The machinery — seeded random, noise, painting, encoding, seam checks —
// is shared. What is below is this game's own art direction.
import {
  BLACK, WHITE, averageColour, blade, chunk, clamp01,
  colour, courses, crack, crc32, crcTable, decodePngHeader,
  drawCourses, encodePng, fractalNoise, get,  grainPerPixel as grain,
  groundShade, hashCell, indexOf, luminance, makeRandom, mix,
  mixColour, over, paint, patch, periodicNoise, quantise,
  scaleColour, seamRatio, seedFromName, set, smoothstep, stain,
  surface, toBytes, weather, wrap, wrapDelta
} from './lib/texture.mjs'


const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../project/assets/counter-strike')

// ----------------------------------------------------------------- the sand
function sandFloor(image, random) {
  const broad = fractalNoise(random, 3, 3)
  const trodden = periodicNoise(random, 2, 2)
  const gritPatches = periodicNoise(random, 12, 12)
  const fine = periodicNoise(random, 48, 48)
  const wobble = periodicNoise(random, 5, 5)

  const pale = colour('#dbcaa2')
  const mid = colour('#c5ae83')
  const deep = colour('#a68f68')
  const grit = colour('#8d7a59')

  paint(image, (x, y, u, v) => {
    let pixel = mixColour(deep, mid, clamp01(0.1 + 1.8 * (broad(u, v) - 0.35)))
    // Trodden ground is paler and flatter where feet have polished it, and the
    // loose sand between the paths is where the grit collects.
    const path = clamp01((trodden(u, v) - 0.42) * 2.8)
    pixel = mixColour(pixel, pale, 0.6 * path)
    const gravel = clamp01((gritPatches(u, v) - 0.48) * 2.8) * (1 - 0.6 * path)
    pixel = mixColour(pixel, grit, 0.5 * gravel * clamp01((fine(u, v) - 0.3) * 2.2))
    pixel = mixColour(pixel, pale, 0.14 * fine(u, v))
    return pixel
  })

  // A few large stains rather than many small ones.
  for (let i = 0; i < 6; i++) {
    stain(image, random() * image.width, random() * image.height, image.width * (0.1 + 0.14 * random()),
      i % 2 ? deep : pale, 0.22, wobble)
  }

  // Loose stones: a lit top, a shadow under, nothing more. They stay close to
  // the colour of the ground they are lying on, or the floor reads as spotted.
  for (let i = 0; i < 170; i++) {
    const centreX = random() * image.width
    const centreY = random() * image.height
    const radius = 1 + random() * 2.4
    const tint = mixColour(mid, random() < 0.55 ? grit : pale, 0.3 + 0.35 * random())
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const distance = Math.hypot(dx, dy * 1.25)
        if (distance > radius) continue
        const lit = clamp01(0.55 - dy * 0.25)
        over(image, centreX + dx, centreY + dy, mixColour(tint, WHITE, 0.18 * lit), 0.6)
      }
    }
    for (let dx = -2; dx <= 2; dx++) over(image, centreX + dx, centreY + radius, grit, 0.28)
  }

  grain(image, random, 0.045)
}

function tunnelFloor(image, random) {
  const broad = fractalNoise(random, 3, 3)
  const ruts = periodicNoise(random, 3, 3)
  const speckle = periodicNoise(random, 40, 40)
  const wobble = periodicNoise(random, 6, 6)

  const dirt = colour('#6f5f47')
  const dry = colour('#93805f')
  const damp = colour('#4e4334')

  paint(image, (x, y, u, v) => {
    let pixel = mixColour(damp, dry, clamp01(0.2 + 1.2 * (broad(u, v) - 0.18)))
    pixel = mixColour(pixel, dirt, 0.4)
    pixel = mixColour(pixel, damp, 0.4 * clamp01((ruts(u, v) - 0.5) * 2.6))
    pixel = mixColour(pixel, dry, 0.16 * speckle(u, v))
    return pixel
  })

  for (let i = 0; i < 4; i++) {
    stain(image, random() * image.width, random() * image.height, image.width * (0.12 + 0.14 * random()), damp, 0.2, wobble)
  }
  // Small stones pressed into the dirt, barely lighter than it. A stone that
  // stands out is a stone lying on top, and these are trodden in.
  for (let i = 0; i < 60; i++) {
    const centreX = random() * image.width
    const centreY = random() * image.height
    const radius = 0.8 + random() * 1.8
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (Math.hypot(dx, dy) > radius) continue
        over(image, centreX + dx, centreY + dy, mixColour(dirt, dry, dy < 0 ? 0.75 : 0.35), 0.55)
      }
    }
  }
  grain(image, random, 0.05)
}

// ---------------------------------------------------------------- the stone
// The stone palettes below are already a long way off the tan they started as:
// dust2's sandstone is a grey-brown that the sun has taken most of the colour out
// of, and the candy tan a painter reaches for first is the commonest mistake in
// the whole set. `weather` then pulls another two fifths of the remaining chroma
// out on top, which is what the saturation column in the manifest is for.
function sandstoneBlock(image, random) {
  drawCourses(image, {
    random, columns: 2, rows: 4, mortarWidth: 3.2, chipChance: 0.35,
    light: colour('#d2c1a0'), dark: colour('#a3947a'), mortar: colour('#7c7461'),
    roughness: 2.2, bevel: 0.2
  })
  const wobble = periodicNoise(random, 5, 5)
  for (let i = 0; i < 4; i++) {
    stain(image, random() * image.width, random() * image.height, image.width * (0.1 + 0.1 * random()),
      i % 2 ? colour('#7f7663') : colour('#ded5bd'), 0.15, wobble)
  }
  for (let i = 0; i < 3; i++) {
    crack(image, random, random() * image.width, random() * image.height, 26 + random() * 30,
      random() * Math.PI * 2, colour('#655f4e'), 0.4)
  }
  weather(image, random, { chroma: 0.28, grime: 0.26, bleach: 0.12 })
  grain(image, random, 0.04)
}

function sandstoneBrick(image, random) {
  drawCourses(image, {
    random, columns: 4, rows: 8, mortarWidth: 2.1, chipChance: 0.28,
    light: colour('#ccb994'), dark: colour('#9a8b6e'), mortar: colour('#79715c'),
    roughness: 1.8, bevel: 0.18
  })
  const wobble = periodicNoise(random, 6, 6)
  for (let i = 0; i < 5; i++) {
    stain(image, random() * image.width, random() * image.height, image.width * (0.08 + 0.1 * random()),
      i % 2 ? colour('#7f7663') : colour('#d8cdb4'), 0.17, wobble)
  }
  weather(image, random, { chroma: 0.28, grime: 0.28, bleach: 0.12 })
  grain(image, random, 0.045)
}

function tunnelWall(image, random) {
  drawCourses(image, {
    random, columns: 3, rows: 6, mortarWidth: 2.4, chipChance: 0.3,
    light: colour('#918878'), dark: colour('#635c4e'), mortar: colour('#46423a'),
    roughness: 2.4, bevel: 0.14
  })
  const wobble = periodicNoise(random, 5, 5)
  const seep = fractalNoise(random, 3, 3)
  // Damp reads as a cool shift, not as black: the tunnels are darker but they are
  // still the same sandstone as everything above them.
  const cool = colour('#4a4a46')
  paint(image, (x, y, u, v) => {
    const wet = clamp01((seep(u, v) - 0.5) * 2.2)
    return mixColour(get(image, x, y), cool, 0.35 * wet)
  })
  for (let i = 0; i < 4; i++) {
    stain(image, random() * image.width, random() * image.height, image.width * (0.1 + 0.12 * random()),
      i % 2 ? colour('#3a3831') : colour('#b0aa99'), 0.22, wobble)
  }
  // Underground, so the bleach at the top is a weak reflected light rather than
  // sun, and the grime at the bottom is heavier than anything outside.
  weather(image, random, { chroma: 0.28, grime: 0.32, grimeColour: colour('#332f27'), bleach: 0.06 })
  grain(image, random, 0.05)
}

/**
 * Rendered plaster over brick, and the emphasis is on *plaster*.
 *
 * The version this replaces scattered large dark blobs over the whole face until
 * they covered about half of it, and the result read as cow-hide: patches in the
 * middle of a wall are patches nothing caused, and at that size and that count
 * their shapes are recognisable the moment the tile repeats. Rendering does not
 * fail like that. It fails where something hits it — along the ground, where
 * boots and barrows and dropped things reach, and at the odd knock higher up —
 * so a wall like this is nine tenths intact with a tenth flaked away, low down.
 *
 * So: brick first, plaster over the top of it, and the plaster is then eroded by
 * a noise field that has to beat a threshold which climbs steeply with height.
 * At the ground line about two fifths of the render is gone; a metre up, none of
 * it is; over the tile as a whole it is a little under an eighth. The height term
 * is `groundShade`, a cosine at the tile's own frequency, so the damage runs off
 * the bottom of one tile and onto the top of the next with no join.
 *
 * Each patch shows the courses behind it, sits in the shadow the surrounding
 * render throws into it, and carries a lit lip along its broken edge — which is
 * the detail that says the plaster has thickness rather than being a colour.
 */
function plasterWall(image, random) {
  // The brick is painted first and then buried, because the flaked patches have
  // to expose the real thing rather than a drawing of one. Brick that has spent
  // its life under render is dusty and grey, not the red of a new one.
  drawCourses(image, {
    random, columns: 5, rows: 10, mortarWidth: 1.7, chipChance: 0.22,
    light: colour('#a89076'), dark: colour('#85735f'), mortar: colour('#8f8678'),
    roughness: 1.2, bevel: 0.12
  })

  const patchNoise = fractalNoise(random, 6, 6, 3)
  const edgeNoise = periodicNoise(random, 28, 28)
  const mottle = fractalNoise(random, 4, 4)
  const fineNoise = periodicNoise(random, 40, 40)
  const wobble = periodicNoise(random, 6, 6)
  const plasterLight = colour('#cfc7b3')
  const plasterMid = colour('#b5ad99')
  const plasterDark = colour('#948c7b')

  // How willing the render is to come off, by height: one at the ground line and
  // nothing above waist height. The power sharpens it so the damage stays low
  // instead of creeping up into the middle of the wall.
  const reach = v => groundShade(v, 0.88) ** 2.2

  paint(image, (x, y, u, v) => {
    const brick = get(image, x, y)
    const loss = patchNoise(u, v) + 0.10 * (edgeNoise(u, v) - 0.5)
    // 0.86 at the top, 0.50 at the ground. The noise sits around 0.5, so nothing
    // beats the first number and roughly two fifths beats the second.
    const bare = loss - (0.86 - 0.36 * reach(v))

    if (bare > 0) {
      // Exposed brick, in the shadow the render around the hole throws into it,
      // and paler than raw brick because plaster dust is still on it.
      let stone = mixColour(brick, BLACK, 0.3 * clamp01(1 - bare / 0.05))
      return mixColour(stone, plasterDark, 0.12)
    }

    let plaster = mixColour(plasterMid, plasterLight, clamp01(0.35 + 1.2 * (mottle(u, v) - 0.3)))
    plaster = mixColour(plaster, plasterDark, 0.2 * fineNoise(u, v))
    // The broken lip: render is several millimetres thick, so the rim of every
    // patch stands proud of the brick and catches the light along it.
    const lip = clamp01(1 + bare / 0.045)
    return mixColour(plaster, WHITE, 0.3 * lip * lip)
  })

  for (let i = 0; i < 5; i++) {
    stain(image, random() * image.width, random() * image.height, image.width * (0.09 + 0.13 * random()),
      i % 2 ? colour('#918a7a') : colour('#ddd8c8'), 0.16, wobble)
  }
  // Cracks in the render, which is the one high-contrast detail an intact
  // plaster wall has. Started low, because that is where the wall is stressed.
  for (let i = 0; i < 5; i++) {
    crack(image, random, random() * image.width, image.height * (0.45 + 0.55 * random()), 40 + random() * 70,
      random() * Math.PI * 2, colour('#6f695b'), 0.4)
  }
  weather(image, random, { chroma: 0.3, grime: 0.3, bleach: 0.13 })
  grain(image, random, 0.035)
}

/**
 * The dark painted band along the base of a wall.
 *
 * Authored as a band: it repeats along the wall, and one tile is its full height.
 * Vertically it is a composition rather than a repeat — the paint edge is at the
 * top and the ground is at the bottom — so the seam check only asks it to tile
 * across.
 */
function plasterTrim(image, random) {
  const mottle = fractalNoise(random, 4, 2)
  const edgeWobble = periodicNoise(random, 16, 2)
  const wear = periodicNoise(random, 24, 6)
  const wobble = periodicNoise(random, 6, 6)

  const plaster = colour('#d6c8a7')
  const painted = colour('#6f5a3d')
  const paintDeep = colour('#54432c')
  const ground = colour('#3f3222')

  const edgeAt = u => image.height * 0.3 + (edgeWobble(u, 0.5) - 0.5) * 4

  paint(image, (x, y, u, v) => {
    const edge = edgeAt(u)
    if (y < edge) {
      let pixel = mixColour(plaster, colour('#b6a684'), 0.4 * mottle(u, v))
      if (edge - y < 2) pixel = mixColour(pixel, BLACK, 0.2 * (2 - (edge - y)) / 2)
      return pixel
    }
    const down = (y - edge) / (image.height - edge)
    let pixel = mixColour(painted, paintDeep, 0.5 * down)
    pixel = mixColour(pixel, paintDeep, 0.25 * (mottle(u, v) - 0.4))
    // The brush left a lighter edge where the paint ran thin. Chipping is rare
    // and it happens at the top of the band, where the painter's line is thin,
    // and at the very bottom, where the ground has knocked it off. A band chipped
    // all over reads as camouflage rather than as paint.
    if (y - edge < 2) pixel = mixColour(pixel, plaster, 0.22 * (1 - (y - edge) / 2))
    const reachable = Math.max(clamp01(1 - down * 3.2), clamp01((down - 0.82) * 5))
    const chip = clamp01((wear(u, v) - 0.72) * 4) * reachable
    if (chip > 0) pixel = mixColour(pixel, plaster, 0.85 * chip)
    pixel = mixColour(pixel, ground, 0.5 * clamp01((down - 0.8) * 5))
    return pixel
  })

  for (let i = 0; i < 3; i++) {
    stain(image, random() * image.width, image.height * (0.55 + 0.4 * random()), image.height * (0.2 + 0.25 * random()),
      colour('#33291b'), 0.16, wobble)
  }
  // No grime term: this band is already a composition from its paint line down to
  // the ground, so the only thing it wants from the weather pass is the chroma
  // pull that keeps it in the same world as the wall it sits under, and the drift
  // that stops a long run of it reading as one extruded stripe.
  weather(image, random, { chroma: 0.36, grime: 0, bleach: 0, drift: 0.1, driftCells: 4 })
  grain(image, random, 0.04)
}

/**
 * A flight of worn steps — and, this time, not a second copy of the brick.
 *
 * These two used to be tan horizontal courses at almost the same scale, which
 * wasted one of the two slots: from any distance a staircase and a wall are the
 * same picture. A stair is not a wall. It is a grey limestone slab, not a warm
 * sandstone one; its middle has been walked smooth and pale over a few hundred
 * years; and the back corner of every tread, where a broom has never reached,
 * has filled up with dirt. Four steps to the tile against the brick's eight
 * courses, a cool stone against a warm one, and a bright polished band down the
 * depth of every tread is enough that you can never mistake one for the other.
 *
 * Down one step: the dirt-packed corner where the riser above lands on the
 * tread, then the tread itself worn palest where feet fall, then the nosing
 * rounded over and catching the light, then the riser falling away into shade.
 */
function stairsStone(image, random) {
  const steps = 4
  const stepHeight = image.height / steps
  const treadBack = 3                    // the corner the riser above stands in
  const treadFront = stepHeight * 0.46   // where the tread rolls over into the nose
  const noseFoot = stepHeight * 0.56     // where the nosing has turned into riser
  const grit = periodicNoise(random, 24, 24)
  const patina = fractalNoise(random, 4, 4)
  const walked = fractalNoise(random, 2, 2, 3)
  const wobble = periodicNoise(random, 6, 6)
  const joint = periodicNoise(random, 32, 16)

  // Grey limestone. Nothing in this palette is warmer than a fifth of a step of
  // hue away from neutral, which is the whole point of it.
  const polished = colour('#c2bfb6')
  const stoneLight = colour('#a9a69c')
  const stone = colour('#8e8b82')
  const stoneDark = colour('#6a6862')
  const dirt = colour('#4a463b')
  const shadow = colour('#302e29')

  paint(image, (x, y, u, v) => {
    const step = Math.floor(y / stepHeight)
    const localY = y - step * stepHeight
    const tone = 0.5 + 0.5 * (patina(u, v) - 0.5) + 0.3 * (grit(u, v) - 0.5)
    // Slabs: a vertical joint every half tile, staggered step by step, running
    // through the tread and the riser alike because it is one stone.
    const slabU = wrap(u + (step % 2) * 0.25, 1)
    const acrossSlab = Math.min(wrap(slabU, 0.5), 0.5 - wrap(slabU, 0.5))
    const inJoint = acrossSlab < 0.008 + 0.006 * (joint(u, v) - 0.5)

    let pixel
    if (localY < treadBack) {
      // The internal corner. Sweepings, grit and rain sit in it and never leave,
      // so it is the darkest and the brownest line on the whole texture.
      pixel = mixColour(dirt, shadow, 0.4 - 0.15 * tone)
    } else if (localY < treadFront) {
      // The tread. `depth` is 0 against the riser behind and 1 at the nose.
      const depth = (localY - treadBack) / (treadFront - treadBack)
      pixel = mixColour(stone, stoneLight, clamp01(0.3 + 0.6 * tone))
      // Feet land across the middle of the tread and neither on the back of it
      // nor over the very edge, so the polish is a band in depth, not a wash. It
      // wanders with a slow noise so no two treads are worn in the same place.
      const band = smoothstep(clamp01(1 - Math.abs(depth - 0.58) / 0.42))
      const traffic = clamp01(0.35 + 1.5 * (walked(u, v) - 0.42))
      pixel = mixColour(pixel, polished, 0.62 * band * traffic)
      // Dirt banks up against the riser behind and into the slab joints.
      pixel = mixColour(pixel, dirt, 0.5 * (1 - smoothstep(clamp01(depth * 2.6))))
      pixel = mixColour(pixel, dirt, 0.3 * clamp01(1 - acrossSlab / 0.03) * (1 - band * traffic))
    } else if (localY < noseFoot) {
      // The nosing, rounded rather than chamfered: brightest at the crown of the
      // roll and falling off both ways.
      const round = 1 - Math.abs((localY - treadFront) / (noseFoot - treadFront) - 0.35) / 0.65
      pixel = mixColour(stoneLight, polished, clamp01(0.2 + 0.8 * smoothstep(clamp01(round))))
      pixel = mixColour(pixel, WHITE, 0.16 * clamp01(round))
    } else {
      const down = (localY - noseFoot) / (stepHeight - noseFoot)
      pixel = mixColour(stoneDark, stone, clamp01(0.2 + 0.5 * tone))
      // The riser is in the shade of its own nosing at the top and collects dirt
      // where it meets the tread below.
      pixel = mixColour(pixel, shadow, 0.34 * (1 - smoothstep(clamp01(down * 3))))
      pixel = mixColour(pixel, dirt, 0.34 * smoothstep(clamp01((down - 0.6) * 2.5)))
    }
    if (inJoint) pixel = mixColour(pixel, shadow, 0.55)
    return pixel
  })

  for (let i = 0; i < 4; i++) {
    stain(image, random() * image.width, random() * image.height, image.width * (0.07 + 0.09 * random()),
      i % 2 ? colour('#514d43') : colour('#c8c5bb'), 0.16, wobble)
  }
  // Chips out of the nosing, where a step actually wears. They break the bright
  // edge rather than sitting on the tread as spots, which is the difference
  // between a worn step and a dirty one.
  for (let i = 0; i < 22; i++) {
    const step = Math.floor(random() * steps)
    const centreX = random() * image.width
    const half = 2 + random() * 4
    const depth = 3 + random() * 4
    for (let dx = -half; dx <= half; dx++) {
      const bite = depth * (1 - (dx / half) ** 2)
      // The broken face sits back from the nose, so its lower lip is in shade.
      over(image, centreX + dx, step * stepHeight + treadFront + bite, shadow, 0.5)
      for (let dy = 0; dy < bite; dy++) {
        // Freshly broken stone is paler than walked stone, and the chip eats
        // through the nosing and the tread together — that is what tells you the
        // edge is gone rather than dirty.
        over(image, centreX + dx, step * stepHeight + treadFront + dy,
          mixColour(stoneLight, stone, dy / depth), 0.85 - 0.35 * (dy / depth))
      }
    }
  }
  // A light grime term only: the steps carry their own top-to-bottom shading four
  // times over, and a strong one on top would fight it. This just makes the
  // bottom of the flight dirtier than the top of it.
  weather(image, random, { chroma: 0.3, grime: 0.16, grimeColour: colour('#3f3b33'), bleach: 0.08 })
  grain(image, random, 0.04)
}

function concrete(image, random) {
  const broad = fractalNoise(random, 3, 3)
  const speckle = periodicNoise(random, 64, 64)
  const wobble = periodicNoise(random, 5, 5)

  const light = colour('#a9a69c')
  const mid = colour('#8f8d85')
  const dark = colour('#6e6c66')

  paint(image, (x, y, u, v) => {
    let pixel = mixColour(dark, light, clamp01(0.3 + 1.1 * (broad(u, v) - 0.2)))
    pixel = mixColour(pixel, mid, 0.3)
    pixel = mixColour(pixel, speckle(u, v) > 0.72 ? light : dark, 0.18 * Math.abs(speckle(u, v) - 0.5))
    return pixel
  })
  // There used to be a pour joint drawn along all four edges here, on the theory
  // that a line the eye expects to find at the seam is better than a line it does
  // not. It is not: four edges is a rectangle, and a rectangle repeated is a grid
  // ruled across the whole bomb site at exactly the tile pitch, which is the one
  // thing a floor must never show. A joint at the boundary and nowhere else can
  // only ever be read as the boundary. The slab is now unbroken, and the broad
  // mottling, the pits and the cracks below carry it — none of which lands in the
  // same place twice.

  for (let i = 0; i < 5; i++) {
    stain(image, random() * image.width, random() * image.height, image.width * (0.09 + 0.12 * random()),
      i % 2 ? colour('#5c5a54') : colour('#b6b3a8'), 0.16, wobble)
  }
  // Pits: a dark hole with the light catching its upper lip.
  for (let i = 0; i < 70; i++) {
    const centreX = random() * image.width
    const centreY = random() * image.height
    const radius = 1 + random() * 2
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const distance = Math.hypot(dx, dy)
        if (distance > radius) continue
        over(image, centreX + dx, centreY + dy, dark, 0.6)
      }
    }
    for (let dx = -2; dx <= 2; dx++) over(image, centreX + dx, centreY - radius, light, 0.35)
  }
  for (let i = 0; i < 3; i++) {
    crack(image, random, random() * image.width, random() * image.height, 30 + random() * 50,
      random() * Math.PI * 2, colour('#57554f'), 0.4)
  }
  grain(image, random, 0.04)
}

function ceilingDark(image, random) {
  const broad = fractalNoise(random, 3, 3)
  const patchy = periodicNoise(random, 10, 10)
  const wobble = periodicNoise(random, 5, 5)

  const dark = colour('#3b352d')
  const mid = colour('#4e463a')
  const pale = colour('#6a6052')

  paint(image, (x, y, u, v) => {
    let pixel = mixColour(dark, mid, clamp01(0.25 + 1.2 * (broad(u, v) - 0.2)))
    pixel = mixColour(pixel, pale, 0.22 * clamp01((patchy(u, v) - 0.55) * 3))
    return pixel
  })
  for (let i = 0; i < 4; i++) {
    stain(image, random() * image.width, random() * image.height, image.width * (0.12 + 0.16 * random()),
      i % 2 ? colour('#2b261f') : colour('#7b7161'), 0.2, wobble)
  }
  for (let i = 0; i < 3; i++) {
    crack(image, random, random() * image.width, random() * image.height, 30 + random() * 40,
      random() * Math.PI * 2, colour('#2a251e'), 0.5)
  }
  grain(image, random, 0.035)
}

// ----------------------------------------------------------------- the props
/**
 * The crate.
 *
 * The frame battens are centred on the tile edge, so a wall of crates joins batten
 * to batten instead of showing a cut. Planks run across and the gaps between them
 * are in shadow.
 *
 * There used to be a "this way up" stencil sprayed on it. It has gone, and it had
 * to. `crate.js` declares `tiling: 1`, which in this engine is a density — one
 * repeat per metre — so a 1.6 metre crate shows 1.6 copies of this texture across
 * every face, and a mark that appears once per tile therefore appears in a regular
 * grid across a stack of crates. A stencil is a unique mark; a tiling texture has
 * no unique places in it; the two cannot both be true. The alternative was to make
 * one crate face one tile, but that needs `crate.js` to say `tiling: [1, 1]`, and
 * that file belongs to somebody else. Removing the mark fixes it here, on its own,
 * and at any tiling anyone later chooses.
 *
 * The colour was wrong too. Packing timber is not new pine: it is grey-brown,
 * scuffed to the fibre on every corner, with its plank ends split and darkened by
 * water. Nothing in this palette is as orange as what it replaces.
 */
function crateWood(image, random) {
  const planks = 5
  const plankHeight = image.height / planks
  const battenWidth = image.width * 0.09
  // Grain is long in x and tight in y, which is what makes a board read as sawn.
  const woodGrain = periodicNoise(random, 5, 90)
  const boardTone = periodicNoise(random, 3, planks * 2)
  const wear = fractalNoise(random, 4, 4)
  const splitNoise = periodicNoise(random, 40, planks)
  const wobble = periodicNoise(random, 6, 6)

  const woodLight = colour('#a9997e')
  const wood = colour('#8b7c62')
  const woodDark = colour('#5f5442')
  const gap = colour('#2b2419')
  const battenColour = colour('#7d7159')

  paint(image, (x, y, u, v) => {
    const plank = Math.floor(y / plankHeight)
    const localY = y - plank * plankHeight
    const tone = hashCell(0, plank, 7)
    let pixel = mixColour(wood, woodLight, clamp01(0.2 + 0.6 * tone + 0.5 * (woodGrain(u, v) - 0.5)))
    pixel = mixColour(pixel, woodDark, 0.35 * clamp01(boardTone(u, v) - 0.35))

    // Each board is rounded over: lit along its top edge, dark into the gap below.
    // The edges are where a board splits, greys and takes up water, so they get a
    // ragged darkened margin rather than a ruled line.
    const split = 1.6 + 2.6 * splitNoise(u, v)
    if (localY < 2) pixel = mixColour(pixel, gap, 0.75 * (1 - localY / 2))
    else if (localY < 5) pixel = mixColour(pixel, WHITE, 0.18 * (1 - (localY - 2) / 3))
    if (localY < split + 3) pixel = mixColour(pixel, woodDark, 0.5 * clamp01(1 - localY / (split + 3)))
    if (plankHeight - localY < 3) pixel = mixColour(pixel, gap, 0.5 * (1 - (plankHeight - localY) / 3))
    if (plankHeight - localY < split + 4) {
      pixel = mixColour(pixel, woodDark, 0.45 * clamp01(1 - (plankHeight - localY) / (split + 4)))
    }

    // Two upright battens: one across the middle of the face and one straddling
    // the tile edge, so a stack of crates joins batten to batten.
    const acrossBatten = Math.min(
      Math.abs(wrapDelta(x, image.width)),
      Math.abs(wrapDelta(x - image.width / 2, image.width))
    )
    if (acrossBatten < battenWidth / 2) {
      const into = acrossBatten / (battenWidth / 2)
      pixel = mixColour(battenColour, mixColour(battenColour, woodLight, 0.35), 0.5 * (1 - into))
      pixel = mixColour(pixel, woodDark, 0.4 * (woodGrain(u, v)))
      // The batten stands proud, so its far side casts a line of shadow.
      if (into > 0.86) pixel = mixColour(pixel, gap, 0.45)
    }
    pixel = mixColour(pixel, woodDark, 0.25 * clamp01((wear(u, v) - 0.55) * 2.5))
    return pixel
  })

  // Knots.
  for (let i = 0; i < 5; i++) {
    const centreX = random() * image.width
    const centreY = random() * image.height
    const radius = 3 + random() * 3
    for (let dy = -8; dy <= 8; dy++) {
      for (let dx = -10; dx <= 10; dx++) {
        const distance = Math.hypot(dx * 0.8, dy)
        if (distance > radius * 1.8) continue
        const ring = Math.cos(distance * 1.9) * 0.5 + 0.5
        const strength = clamp01(1 - distance / (radius * 1.8))
        over(image, centreX + dx, centreY + dy, mixColour(woodDark, gap, ring), 0.55 * strength * strength)
      }
    }
  }

  // Nails, where the battens cross the boards.
  for (let plank = 0; plank < planks; plank++) {
    for (const battenCentre of [0, image.width / 2]) {
      const centreY = plank * plankHeight + plankHeight * 0.5
      for (const offset of [-battenWidth * 0.22, battenWidth * 0.22]) {
        const centreX = battenCentre + offset
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            over(image, centreX + dx, centreY + dy, colour('#4a453f'), 0.85)
          }
        }
        over(image, centreX, centreY - 1, colour('#a29a8c'), 0.7)
      }
    }
  }
  // Scuffs: short pale scrapes where the crate has been dragged and the grey
  // surface has been rubbed back to lighter fibre underneath. They run along the
  // grain, because that is the way a board gives up.
  for (let i = 0; i < 40; i++) {
    const startX = random() * image.width
    const startY = random() * image.height
    const length = 6 + random() * 26
    const pale = mixColour(woodLight, WHITE, 0.2 + 0.25 * random())
    for (let step = 0; step < length; step++) {
      const fade = Math.sin((step / length) * Math.PI)
      over(image, startX + step, startY + (random() - 0.5) * 1.2, pale, 0.3 * fade)
    }
  }

  for (let i = 0; i < 3; i++) {
    stain(image, random() * image.width, random() * image.height, image.width * (0.08 + 0.1 * random()),
      colour('#4c4436'), 0.18, wobble)
  }
  // A crate stands on the ground, so its bottom boards are the dirty ones. The
  // chroma pull is gentler than the stone's — wood keeps some colour even when it
  // has gone grey — but `crate.js` multiplies a tint of #b58a52 over this, which
  // will put most of the orange straight back. That is a call for whoever owns
  // that file; the texture underneath is now the right colour on its own.
  weather(image, random, { chroma: 0.3, grime: 0.24, grimeColour: colour('#3d372c'), bleach: 0.08, drift: 0.12 })
  grain(image, random, 0.04)
}

// --------------------------------------------------------------- the doors
/**
 * THE TWO DOORS ARE 1:1. THEY MUST BE DECLARED `tiling: [1, 1]`.
 *
 * Both of these used to be built round a frame centred on the tile edge so that
 * the texture would still join to itself. That was care spent on the wrong
 * problem. A door is a single object seen once; a material is a surface seen a
 * hundred times; and drawing an object as a material gives you, exactly and
 * unavoidably, a wall of doors. No amount of skill about where the frame sits
 * fixes that, because the fault is one level up.
 *
 * So each of these is now one whole door — jambs, head, threshold, leaves,
 * panels, hinges, handles — drawn once, at the proportion of the surface it goes
 * on, with nothing in it that repeats and no seam constraint on it at all.
 *
 * `tiling: [1, 1]` is the declaration that means "this picture, once". The bare
 * `tiling: 1` that the placements in de_dust2.json carry today is not the same
 * thing: in this engine a bare number is a DENSITY, one repeat per metre, so a
 * 1.6 by 2.4 metre door shows 1.6 copies across and 2.4 up. That is where the
 * wall of doors came from in the map as well as on the contact sheet, and the
 * texture cannot fix it from here. Whoever owns project/types/door.js and the
 * door placements has to change the word.
 *
 * Sizes are 160 pixels to the metre over the boxes those placements declare —
 * 1.6 by 2.4 for the blue pair, 1.4 by 2.4 for the steel one — which is 256 by
 * 384 and 224 by 384. Neither is a power of two and neither should be: a door is
 * a 2:3 object and a 7:12 one, and rounding either to 256 square would stretch it
 * by a third. These are the two assets the power-of-two rule is relaxed for, and
 * they are relaxed for it because they never repeat, so nothing about mip levels
 * or wrap modes cares.
 *
 * Being 1:1 also buys the thing a tiling texture can never have: a real
 * top-to-bottom gradient. Both doors are bleached across the head and filthy
 * along the foot, said with a straight ramp instead of a cosine.
 */

/**
 * The blue-green double doors at long, mid and B.
 *
 * Panelled joinery, which is the construction dust2's doors actually have: two
 * leaves, a stile up each side of each leaf, a top rail, a deep lock rail at
 * handle height and a deeper bottom rail, with a recessed panel between them.
 * Three butt hinges to a leaf on the jamb side, a lever and an escutcheon each
 * side of the meeting stile at 1.05 metres, which is where a door handle is.
 */
function doorBlue(image, random) {
  const perMetre = image.height / 2.4
  const px = metres => Math.round(metres * perMetre)

  const grainNoise = periodicNoise(random, 4, 120)
  const wearNoise = fractalNoise(random, 5, 8)
  const mottle = fractalNoise(random, 3, 4)
  const wobble = periodicNoise(random, 6, 6)

  const paintLight = colour('#6d968e')
  const paintMid = colour('#4a716c')
  const paintDark = colour('#2f4b49')
  const paintDeep = colour('#1c3231')
  const bareWood = colour('#8a8172')
  const frameColour = colour('#3f5f5b')
  const filth = colour('#37332a')

  const jamb = px(0.1)
  const sill = px(0.06)
  const openLeft = jamb
  const openRight = image.width - jamb
  const openTop = jamb
  const openBottom = image.height - sill
  const meet = Math.round(image.width / 2)
  const halfGap = Math.max(1, px(0.007))
  const stile = px(0.09)
  const bead = 3

  // 1.05 m above the ground is where a handle is, and everything else on a
  // panelled door is laid out around the rail that carries it.
  const lockCentre = image.height - px(1.05)
  const lockTop = lockCentre - px(0.075)
  const lockBottom = lockCentre + px(0.075)
  const topRail = openTop + px(0.09)
  const bottomRail = openBottom - px(0.2)
  const panels = [[topRail, lockTop], [lockBottom, bottomRail]]

  paint(image, (x, y, u, v) => {
    const sun = 1 - smoothstep(clamp01(v * 1.2))
    const dust = smoothstep(clamp01((v - 0.55) / 0.45))

    const outX = x < openLeft ? openLeft - x : (x >= openRight ? x - openRight + 1 : 0)
    const outY = y < openTop ? openTop - y : (y >= openBottom ? y - openBottom + 1 : 0)
    const out = Math.max(outX, outY)

    let pixel
    if (out > 0) {
      // The frame. Darkest against the opening, where the reveal turns away from
      // the light, and edged with one hard line so the door sits in a wall rather
      // than floating on it.
      pixel = mixColour(frameColour, paintDeep, clamp01(1.15 - out / 4))
      pixel = mixColour(pixel, paintMid, 0.35 * clamp01((out - 3) / jamb))
      // One hard line right round the outside, and only the outside. Measured per
      // axis against that side's own thickness, or the shallow threshold turns the
      // whole head into a black bar.
      const thickness = y >= openBottom ? sill : jamb
      if (outX >= jamb - 1 || outY >= thickness - 1) pixel = mixColour(pixel, BLACK, 0.55)
      if (y >= openBottom) pixel = mixColour(pixel, filth, 0.5)
    } else {
      const leaf = x < meet ? 0 : 1
      const leafLeft = leaf === 0 ? openLeft : meet + halfGap
      const leafRight = leaf === 0 ? meet - halfGap : openRight
      if (x < leafLeft || x >= leafRight) {
        // The slot between the two leaves: black, with the edge of the near leaf
        // catching a little light down one side of it.
        return mixColour(BLACK, paintDeep, x < meet ? 0.45 : 0.15)
      }

      pixel = mixColour(paintMid, paintLight, clamp01(0.3 + 1.0 * (mottle(u, v) - 0.28)))
      pixel = mixColour(pixel, paintDark, 0.26 * (grainNoise(u, v) - 0.4))

      const panelLeft = leafLeft + stile
      const panelRight = leafRight - stile
      for (const [top, bottom] of panels) {
        if (x < panelLeft - bead || x >= panelRight + bead || y < top - bead || y >= bottom + bead) continue
        if (x >= panelLeft && x < panelRight && y >= top && y < bottom) {
          // The field of the panel is set back from the frame of the leaf, so its
          // head and its hinge side are in shadow and the other two catch light.
          pixel = mixColour(pixel, paintDark, 0.2)
          const fromLeft = x - panelLeft
          const fromTop = y - top
          const fromRight = panelRight - 1 - x
          const fromBottom = bottom - 1 - y
          if (fromTop < 4) pixel = mixColour(pixel, BLACK, 0.4 * (1 - fromTop / 4))
          if (fromLeft < 4) pixel = mixColour(pixel, BLACK, 0.32 * (1 - fromLeft / 4))
          if (fromBottom < 4) pixel = mixColour(pixel, WHITE, 0.16 * (1 - fromBottom / 4))
          if (fromRight < 4) pixel = mixColour(pixel, WHITE, 0.18 * (1 - fromRight / 4))
        } else {
          // The bead: the small raised moulding that holds the panel in.
          pixel = mixColour(pixel, y < top || x < panelLeft ? WHITE : BLACK, 0.15)
        }
      }

      // The leaf edges. Every stile and rail is a separate piece of timber and
      // the joints between them show.
      if (x - leafLeft < 2) pixel = mixColour(pixel, BLACK, 0.3 * (1 - (x - leafLeft) / 2))
      if (leafRight - 1 - x < 2) pixel = mixColour(pixel, WHITE, 0.14 * (1 - (leafRight - 1 - x) / 2))
      if (Math.abs(y - lockTop) < 1 || Math.abs(y - lockBottom) < 1) pixel = mixColour(pixel, paintDark, 0.4)
      if (Math.abs(y - topRail) < 1 || Math.abs(y - bottomRail) < 1) pixel = mixColour(pixel, paintDark, 0.35)
    }

    // Paint gives up along the foot of a door first, where it is kicked and where
    // water stands against it, and the head of it is bleached instead.
    const worn = clamp01((wearNoise(u, v) - 0.5) * 3) * clamp01(dust * 1.5)
    pixel = mixColour(pixel, bareWood, 0.6 * worn)
    pixel = mixColour(pixel, colour('#c9d3ce'), 0.16 * sun)
    pixel = mixColour(pixel, filth, 0.36 * dust)
    return pixel
  })

  // ------------------------------------------------------------- the ironmongery
  const ironDark = colour('#26251f')
  const ironLight = colour('#8e8c80')
  /** A butt hinge: the knuckle on the leaf edge and the plate screwed beside it. */
  const hinge = (edgeX, centreY, facing) => {
    const half = px(0.055)
    const knuckle = Math.max(3, px(0.026))
    const plate = Math.max(5, px(0.05))
    for (let dy = -half; dy <= half; dy++) {
      for (let dx = 0; dx < knuckle; dx++) {
        const round = 1 - Math.abs(dx / Math.max(knuckle - 1, 1) - 0.3) * 1.7
        over(image, edgeX + facing * dx, centreY + dy, mixColour(ironDark, ironLight, clamp01(0.15 + 0.6 * round)), 0.95)
      }
      for (let dx = knuckle; dx < knuckle + plate; dx++) {
        over(image, edgeX + facing * dx, centreY + dy, mixColour(ironDark, ironLight, 0.3), 0.9)
      }
    }
    for (const at of [-half * 0.55, half * 0.55]) {
      const screwX = edgeX + facing * (knuckle + plate * 0.55)
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) over(image, screwX + dx, centreY + at + dy, ironDark, 0.8)
      }
      over(image, screwX, centreY + at - 1, ironLight, 0.6)
    }
  }
  for (const at of [0.16, 0.5, 0.87]) {
    const centreY = openTop + (openBottom - openTop) * at
    hinge(openLeft, centreY, 1)
    hinge(openRight - 1, centreY, -1)
  }

  // A lever and an escutcheon each side of the meeting stile, at handle height.
  for (const side of [-1, 1]) {
    const roseX = meet + side * px(0.055)
    for (let dy = -px(0.045); dy <= px(0.045); dy++) {
      for (let dx = -px(0.022); dx <= px(0.022); dx++) {
        if (Math.hypot(dx / px(0.022), dy / px(0.045)) > 1) continue
        over(image, roseX + dx, lockCentre + dy, mixColour(ironDark, ironLight, clamp01(0.55 - (dx + dy) * 0.03)), 0.96)
      }
    }
    // The lever, pointing away from the join, and the shadow it drops on the leaf.
    for (let i = 0; i < px(0.13); i++) {
      const leverX = roseX + side * (px(0.02) + i)
      const taper = 1 - 0.4 * (i / px(0.13))
      for (let dy = -2; dy <= 2; dy++) {
        if (Math.abs(dy) > 2 * taper) continue
        over(image, leverX, lockCentre + dy, mixColour(ironDark, ironLight, clamp01(0.7 - dy * 0.18)), 0.95)
      }
      over(image, leverX, lockCentre + 3, BLACK, 0.28)
    }
    // The keyhole below it.
    for (let dy = 0; dy < px(0.02); dy++) over(image, roseX, lockCentre + px(0.03) + dy, BLACK, 0.7)
  }

  for (let i = 0; i < 3; i++) {
    stain(image, random() * image.width, image.height * (0.6 + 0.38 * random()), image.width * (0.09 + 0.11 * random()),
      colour('#2a3736'), 0.2, wobble)
  }
  grain(image, random, 0.03)
}

/**
 * The steel door set into the building fronts, the ones that lead nowhere.
 *
 * A pressed sheet in a steel frame: two shallow pressings, a riveted kick plate
 * along the foot, three hinges down the left and a lever at 1.05 metres on the
 * right. 224 by 384 is 160 pixels to the metre over the 1.4 by 2.4 metre box
 * every metal-door placement declares. Like the blue one it is 1:1 and needs
 * `tiling: [1, 1]`.
 *
 * The steel is grey-blue and the rust is dark and local. The version this
 * replaces laid a light warm brown over the whole plate at nearly even strength,
 * and an even wash of pale brown over grey is pink — which is exactly what the
 * sheet read as. Rust is not a tint. It starts where water sits and where the
 * coating has been broken: along the threshold, up the corners, and around every
 * rivet and hinge, with a streak running down out of each one. Everywhere else
 * the paint is still on the door.
 */
function doorMetal(image, random) {
  const perMetre = image.height / 2.4
  const px = metres => Math.round(metres * perMetre)

  const mottle = fractalNoise(random, 4, 6)
  const rustNoise = fractalNoise(random, 5, 7, 4)
  const scratch = periodicNoise(random, 90, 10)
  const wobble = periodicNoise(random, 6, 6)

  const steelLight = colour('#9ea8b3')
  const steel = colour('#767f8a')
  const steelDark = colour('#464e58')
  const frameSteel = colour('#565f6a')
  const rust = colour('#6d4126')
  const rustDeep = colour('#452817')
  const filth = colour('#332f28')

  const jamb = px(0.09)
  const sill = px(0.05)
  const openLeft = jamb
  const openRight = image.width - jamb
  const openTop = jamb
  const openBottom = image.height - sill
  const lockCentre = image.height - px(1.05)
  const kickTop = openBottom - px(0.34)
  const inset = px(0.11)
  const pressings = [
    [openTop + inset, lockCentre - px(0.16)],
    [lockCentre + px(0.16), kickTop - inset]
  ]

  /** Where water sits: the foot, the corners, and the line the lintel drips on. */
  const exposure = (x, y) => {
    const down = y / image.height
    const low = smoothstep(clamp01((down - 0.5) / 0.5)) ** 1.4
    const corner = clamp01(1 - Math.min(x - openLeft, openRight - x) / px(0.16)) * clamp01(down * 1.4)
    const head = clamp01(1 - (y - openTop) / px(0.1)) * 0.5
    return clamp01(low * 1.15 + corner * 0.6 + head)
  }

  paint(image, (x, y, u, v) => {
    const sun = 1 - smoothstep(clamp01(v * 1.2))
    const outX = x < openLeft ? openLeft - x : (x >= openRight ? x - openRight + 1 : 0)
    const outY = y < openTop ? openTop - y : (y >= openBottom ? y - openBottom + 1 : 0)
    const out = Math.max(outX, outY)

    let pixel
    if (out > 0) {
      pixel = mixColour(frameSteel, steelDark, clamp01(1.1 - out / 4))
      pixel = mixColour(pixel, steel, 0.3 * clamp01((out - 3) / jamb))
      // Per axis against that side's own thickness — see the blue door.
      const thickness = y >= openBottom ? sill : jamb
      if (outX >= jamb - 1 || outY >= thickness - 1) pixel = mixColour(pixel, BLACK, 0.5)
      if (y >= openBottom) pixel = mixColour(pixel, filth, 0.55)
    } else {
      pixel = mixColour(steel, steelLight, clamp01(0.3 + 1.0 * (mottle(u, v) - 0.3)))
      pixel = mixColour(pixel, steelDark, 0.22 * (scratch(u, v) - 0.45))

      // Two shallow pressings, which is how a cheap steel door pretends to be a
      // panelled one. They are millimetres deep, so the shading is slight.
      for (const [top, bottom] of pressings) {
        const left = openLeft + inset
        const right = openRight - inset
        if (x < left - 2 || x >= right + 2 || y < top - 2 || y >= bottom + 2) continue
        if (x >= left && x < right && y >= top && y < bottom) {
          pixel = mixColour(pixel, steelDark, 0.16)
          const fromTop = y - top
          const fromLeft = x - left
          const fromBottom = bottom - 1 - y
          const fromRight = right - 1 - x
          if (fromTop < 3) pixel = mixColour(pixel, BLACK, 0.4 * (1 - fromTop / 3))
          if (fromLeft < 3) pixel = mixColour(pixel, BLACK, 0.3 * (1 - fromLeft / 3))
          if (fromBottom < 3) pixel = mixColour(pixel, WHITE, 0.2 * (1 - fromBottom / 3))
          if (fromRight < 3) pixel = mixColour(pixel, WHITE, 0.22 * (1 - fromRight / 3))
        } else {
          pixel = mixColour(pixel, y < top || x < left ? WHITE : BLACK, 0.1)
        }
      }

      // The kick plate: a second sheet screwed over the foot of the door, so it
      // stands proud and throws a shadow along its own top edge.
      if (y >= kickTop) {
        pixel = mixColour(pixel, steelDark, 0.1)
        if (y - kickTop < 3) pixel = mixColour(pixel, BLACK, 0.45 * (1 - (y - kickTop) / 3))
        else if (y - kickTop < 6) pixel = mixColour(pixel, WHITE, 0.18 * (1 - (y - kickTop - 3) / 3))
      }
    }

    const eaten = clamp01((rustNoise(u, v) - 0.40) * 3.2) * exposure(x, y)
    pixel = mixColour(pixel, mixColour(rust, rustDeep, clamp01(rustNoise(v, u))), 0.9 * eaten)
    pixel = mixColour(pixel, colour('#c8d0d4'), 0.14 * sun)
    pixel = mixColour(pixel, filth, 0.3 * smoothstep(clamp01((v - 0.6) / 0.4)))
    return pixel
  })

  // ------------------------------------------------------------- the ironmongery
  const ironDark = colour('#2a2a26')
  const ironLight = colour('#9a9a90')
  /** Every fixing bleeds. The halo and the streak are most of what says "steel". */
  const bleed = (centreX, centreY, strength) => {
    for (let dy = -5; dy <= 5; dy++) {
      for (let dx = -5; dx <= 5; dx++) {
        const distance = Math.hypot(dx, dy)
        if (distance < 2.2 || distance > 5) continue
        over(image, centreX + dx, centreY + dy, rust, strength * 0.34 * (1 - (distance - 2.2) / 2.8))
      }
    }
    const run = Math.round(px(0.11))
    for (let i = 0; i < run; i++) {
      const fade = 1 - i / run
      for (let dx = -1; dx <= 1; dx++) {
        over(image, centreX + dx, centreY + 3 + i, mixColour(rust, rustDeep, i / run),
          strength * 0.3 * fade * (dx === 0 ? 1 : 0.5))
      }
    }
  }
  const rivet = (centreX, centreY) => {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (Math.hypot(dx, dy) > 2.2) continue
        over(image, centreX + dx, centreY + dy, mixColour(ironDark, ironLight, clamp01(0.5 - (dx + dy) * 0.2)), 0.92)
      }
    }
    bleed(centreX, centreY, 1)
  }

  const rivets = 9
  for (let i = 0; i < rivets; i++) {
    const centreY = openTop + (i + 0.5) * ((openBottom - openTop) / rivets)
    rivet(openLeft + px(0.04), centreY)
    rivet(openRight - px(0.04), centreY)
  }
  for (let i = 0; i < 6; i++) {
    const centreX = openLeft + px(0.04) + (i + 0.5) * ((openRight - openLeft - px(0.08)) / 6)
    rivet(centreX, kickTop + px(0.03))
    rivet(centreX, openBottom - px(0.04))
  }

  // Three hinges down the left. A steel door hangs on weld-on hinges, so the
  // knuckle is a plain barrel standing off the jamb.
  for (const at of [0.14, 0.5, 0.88]) {
    const centreY = openTop + (openBottom - openTop) * at
    const half = px(0.06)
    for (let dy = -half; dy <= half; dy++) {
      for (let dx = 0; dx < px(0.05); dx++) {
        const round = 1 - Math.abs(dx / Math.max(px(0.05) - 1, 1) - 0.3) * 1.7
        over(image, openLeft - px(0.02) + dx, centreY + dy,
          mixColour(ironDark, ironLight, clamp01(0.15 + 0.6 * round)), 0.95)
      }
    }
    bleed(openLeft + px(0.01), centreY + half, 1.2)
  }

  // The lever, on the right, at the height a hand is.
  const roseX = openRight - px(0.11)
  for (let dy = -px(0.05); dy <= px(0.05); dy++) {
    for (let dx = -px(0.05); dx <= px(0.05); dx++) {
      if (Math.hypot(dx, dy) > px(0.05)) continue
      over(image, roseX + dx, lockCentre + dy, mixColour(ironDark, ironLight, clamp01(0.55 - (dx + dy) * 0.03)), 0.96)
    }
  }
  for (let i = 0; i < px(0.14); i++) {
    const leverX = roseX - px(0.03) - i
    const taper = 1 - 0.4 * (i / px(0.14))
    for (let dy = -2; dy <= 2; dy++) {
      if (Math.abs(dy) > 2 * taper) continue
      over(image, leverX, lockCentre + dy, mixColour(ironDark, ironLight, clamp01(0.72 - dy * 0.18)), 0.95)
    }
    over(image, leverX, lockCentre + 3, BLACK, 0.3)
  }
  bleed(roseX, lockCentre + px(0.05), 0.8)

  for (let i = 0; i < 4; i++) {
    stain(image, random() * image.width, image.height * (0.62 + 0.36 * random()), image.width * (0.08 + 0.1 * random()),
      i % 2 ? rustDeep : filth, 0.22, wobble)
  }
  grain(image, random, 0.035)
}

/**
 * The blue canvas awnings, and the seam that was in them.
 *
 * The stitching along the panel joins was drawn with `if (x % 6 < 4)`, and six
 * does not divide 128. Every other thing in this file wraps because its period
 * divides the texture; this one did not, so the run of dashes came round the
 * right-hand edge out of step with itself and joined into one long white bar. On
 * a tile that is nothing; tiled three times it was a row of white ticks with a
 * gash through it once per repeat, which is precisely what a seam looks like.
 *
 * The period is now eight, which divides 128 sixteen times, so the last stitch
 * before the edge and the first stitch after it are one continuous run of them.
 * The thread has also come down from a bright cream at three-quarters strength —
 * white line on dark blue, the highest contrast anywhere in the set — to a dirty
 * one that varies along its length, because thread on a tarp that has been out
 * in dust2 for ten years is not clean.
 *
 * The two seams stay at a quarter and three quarters down. They are half a tile
 * apart and neither of them is ON the edge, so tiled they make an evenly spaced
 * run of panel joins with nothing marking where one copy stops — which is the
 * opposite of what concrete used to do, and the reason concrete's joints have
 * gone.
 */
function tarpBlue(image, random) {
  const folds = 5
  const fold = periodicNoise(random, 4, 4)
  const weave = periodicNoise(random, 64, 64)
  const bleachNoise = fractalNoise(random, 3, 3)
  const threadWear = periodicNoise(random, 16, 4)
  const wobble = periodicNoise(random, 5, 5)

  const canvas = colour('#3c6288')
  const canvasLight = colour('#5b83aa')
  const canvasDark = colour('#26425e')
  const bleached = colour('#7d99b3')

  paint(image, (x, y, u, v) => {
    // Whole cycles only, or the folds would not meet round the edge.
    const wave = Math.sin(Math.PI * 2 * folds * u + 1.4 * (fold(u, v) - 0.5))
    let pixel = mixColour(canvasDark, canvasLight, clamp01(0.5 + 0.5 * wave))
    pixel = mixColour(pixel, canvas, 0.35)
    pixel = mixColour(pixel, canvasDark, 0.18 * (weave(u, v) - 0.5) * 2)
    // The sun takes the colour out in patches, not in a gradient.
    pixel = mixColour(pixel, bleached, 0.4 * clamp01((bleachNoise(u, v) - 0.5) * 2.4))
    return pixel
  })

  // Stitched seams: two runs of dashes, each with the puckering either side. The
  // period MUST divide the width or the run does not come round the edge in step
  // — that was the seam. Eight divides 128; six did not.
  const stitchPeriod = 8
  if (image.width % stitchPeriod !== 0) throw new Error('the stitch period has to divide the width or the seam shows')
  const thread = colour('#a49c86')
  for (const line of [0.25, 0.75]) {
    const centreY = image.height * line
    for (let x = 0; x < image.width; x++) {
      const dirt = threadWear(x / image.width, line)
      if (x % stitchPeriod < 5) over(image, x, centreY, mixColour(thread, canvasDark, 0.55 * dirt), 0.5 + 0.2 * dirt)
      over(image, x, centreY - 2, BLACK, 0.14)
      over(image, x, centreY + 2, WHITE, 0.08)
    }
  }
  for (let i = 0; i < 3; i++) {
    stain(image, random() * image.width, random() * image.height, image.width * (0.1 + 0.12 * random()),
      i % 2 ? canvasDark : bleached, 0.18, wobble)
  }
  // Canvas keeps its colour better than stone does, so the chroma pull is light,
  // but a tarp hung over a doorway in dust2 is filthy along its bottom edge.
  weather(image, random, { chroma: 0.2, grime: 0.22, grimeColour: colour('#3b3a32'), bleach: 0.1, bleachColour: colour('#cfd6dc') })
  grain(image, random, 0.035)
}

function roofTile(image, random) {
  const columns = 6
  const rows = 4
  const tileWidth = image.width / columns
  const tileHeight = image.height / rows
  const tone = periodicNoise(random, columns * 2, rows * 2)
  const dirt = fractalNoise(random, 4, 4)
  const streakNoise = periodicNoise(random, columns * 6, 2)
  const wobble = periodicNoise(random, 5, 5)

  // Terracotta does not stay the colour it comes out of the kiln. A few summers
  // take it to a dusty muted orange-brown; the bright orange it was is the colour
  // of a new tile in a catalogue, and there are no new tiles on this map.
  const clay = colour('#956950')
  const clayLight = colour('#b28a6d')
  const clayDark = colour('#5e4030')
  const moss = colour('#69694a')

  paint(image, (x, y, u, v) => {
    const row = Math.floor(y / tileHeight)
    const localY = y - row * tileHeight
    // Alternate courses are offset by half a tile, and there is an even number of
    // rows, so the offset comes back to itself at the wrap.
    const shift = (row % 2) * tileWidth * 0.5
    const shifted = wrap(x - shift, image.width)
    const column = Math.floor(shifted / tileWidth)
    const localX = shifted - column * tileWidth

    // The barrel of the pantile: the crown catches the sun, the pan either side
    // of it falls into shade. A weak barrel is what makes a tiled roof read as a
    // brick wall by mistake, so the curve is pushed hard.
    const across = localX / tileWidth
    const barrel = Math.sin(Math.PI * across) ** 0.65
    let pixel = mixColour(clayDark, clayLight, clamp01(0.05 + 1.05 * barrel))
    pixel = mixColour(pixel, clay, 0.25)
    pixel = mixColour(pixel, clayDark, 0.35 * (1 - hashCell(column, row, 13)))

    // The course above overlaps this one, so the top of every tile is in shadow
    // and its bottom lip catches the light.
    if (localY < 5) pixel = mixColour(pixel, BLACK, 0.45 * (1 - localY / 5))
    if (tileHeight - localY < 3) pixel = mixColour(pixel, WHITE, 0.26 * (1 - (tileHeight - localY) / 3))
    // The valley where two tiles meet, which is the deepest shade on the roof.
    const valley = Math.min(localX, tileWidth - localX)
    if (valley < 2.5) pixel = mixColour(pixel, clayDark, 0.55 * (1 - valley / 2.5))

    // Rain runs down the pan of every tile and leaves the dirt behind, so each
    // tile darkens towards its own bottom edge in streaks rather than evenly.
    // Keyed to the tile and not to the texture, so it wraps where the courses do.
    const runOff = (localY / tileHeight) ** 1.6 * clamp01(0.35 + 1.3 * (streakNoise(u, v) - 0.4))
    pixel = mixColour(pixel, clayDark, 0.34 * runOff)
    pixel = mixColour(pixel, moss, 0.32 * clamp01((dirt(u, v) - 0.58) * 3))
    return pixel
  })

  for (let i = 0; i < 4; i++) {
    stain(image, random() * image.width, random() * image.height, image.width * (0.09 + 0.1 * random()),
      i % 2 ? clayDark : colour('#b3a58e'), 0.18, wobble)
  }
  weather(image, random, { chroma: 0.34, grime: 0.2, grimeColour: colour('#413a30'), bleach: 0.12 })
  grain(image, random, 0.04)
}

/**
 * Corrugated sheet.
 *
 * The rust used to be one light warm brown mixed over the whole sheet wherever a
 * noise field said so, and a pale even brown laid over a neutral grey is pink.
 * That is the whole of what was wrong: not the amount of rust but its evenness
 * and its lightness. Corrugated steel is grey-blue and galvanised, and it fails
 * in specific places — along the bottom, where the sheet stands in the dirt, and
 * around every bolt, where the coating was punched through and where water is
 * held against it by the washer. So the rust here is dark, and it is gated by a
 * term that is large near the ground and near a fixing and nearly nothing in the
 * middle of a clean panel.
 */
function metalPanel(image, random) {
  const ribs = 6
  const rustNoise = fractalNoise(random, 3, 3)
  const scuff = periodicNoise(random, 40, 40)
  const wobble = periodicNoise(random, 5, 5)

  const steel = colour('#767f8a')
  const steelLight = colour('#99a4b0')
  const steelDark = colour('#464e58')
  const rust = colour('#6b3f24')
  const rustDeep = colour('#432615')

  paint(image, (x, y, u, v) => {
    // A trapezoidal profile: the flat of the rib, then the flank that turns away.
    const phase = wrap(u * ribs, 1)
    let facing
    if (phase < 0.34) facing = 0.95
    else if (phase < 0.5) facing = mix(0.95, 0.25, (phase - 0.34) / 0.16)
    else if (phase < 0.84) facing = 0.35
    else facing = mix(0.35, 0.95, (phase - 0.84) / 0.16)

    let pixel = mixColour(steelDark, steelLight, facing)
    pixel = mixColour(pixel, steel, 0.3)
    if (phase < 0.02 || phase > 0.98) pixel = mixColour(pixel, WHITE, 0.25)
    if (Math.abs(phase - 0.5) < 0.03) pixel = mixColour(pixel, BLACK, 0.2)
    pixel = mixColour(pixel, steelDark, 0.2 * (scuff(u, v) - 0.5))

    // Rust where the sheet stands in the dirt and where the bolts have punched
    // the coating — the bolt rows are at the tile edge and at half height, so
    // "near a fixing" is a wrapped distance to either of those lines.
    const nearFixing = clamp01(1 - Math.min(
      Math.abs(wrapDelta(y, image.height)),
      Math.abs(wrapDelta(y - image.height / 2, image.height))
    ) / 9)
    const exposure = clamp01(1.15 * groundShade(v, 0.84) ** 1.3 + 0.5 * nearFixing)
    const eaten = clamp01((rustNoise(u, v) - 0.42) * 3.0) * exposure
    pixel = mixColour(pixel, mixColour(rust, rustDeep, clamp01(rustNoise(v, u))), 0.85 * eaten)
    return pixel
  })

  // A run of bolts along the top edge, which is also the tile edge, so a wall of
  // sheets shows one line of fixings rather than two.
  for (let i = 0; i < ribs; i++) {
    const centreX = (i + 0.5) * (image.width / ribs)
    for (const centreY of [0, image.height / 2]) {
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (Math.hypot(dx, dy) > 2.1) continue
          const lit = clamp01(0.5 - (dx + dy) * 0.2)
          over(image, centreX + dx, centreY + dy, mixColour(steelDark, steelLight, lit), 0.9)
        }
      }
    }
  }
  // Rust runs downward out of the fixings it started in.
  for (let i = 0; i < ribs; i++) {
    const centreX = (i + 0.5) * (image.width / ribs)
    for (const centreY of [0, image.height / 2]) {
      const run = 10 + Math.floor(14 * random())
      for (let step = 0; step < run; step++) {
        const fade = 1 - step / run
        for (let dx = -1; dx <= 1; dx++) {
          over(image, centreX + dx, centreY + 3 + step, mixColour(rust, rustDeep, step / run),
            0.32 * fade * (dx === 0 ? 1 : 0.45))
        }
      }
    }
  }
  for (let i = 0; i < 3; i++) {
    stain(image, random() * image.width, image.height * (0.5 + 0.5 * random()), image.width * (0.08 + 0.1 * random()),
      rustDeep, 0.2, wobble)
  }
  // Grey-blue, not grey-brown, so the grime at the foot of the sheet is a cold
  // one and the bleach at the top is a cold one too.
  weather(image, random, {
    chroma: 0.08, grime: 0.24, grimeColour: colour('#332f2a'), peak: 0.84,
    bleach: 0.08, bleachColour: colour('#ccd3d8')
  })
  grain(image, random, 0.04)
}

function rugRed(image, random) {
  const wearNoise = fractalNoise(random, 3, 3)
  const weave = periodicNoise(random, 64, 64)
  const wobble = periodicNoise(random, 5, 5)

  const field = colour('#7a2f2a')
  const fieldDark = colour('#521e1c')
  const cream = colour('#c9b189')
  const gold = colour('#a8813f')
  const border = colour('#3d1614')

  // There used to be a woven border drawn round all four edges of the tile, on
  // the theory that rugs laid side by side would share it. They do not: repeated,
  // four edges is a rectangle and a rectangle repeated is a grid ruled across the
  // floor at exactly the tile pitch — the same fault concrete had, and the giveaway
  // in both cases is that the only line in the picture sits at the only place the
  // eye is looking for one. A carpet does not need a border to be a carpet. What
  // it needs is a motif that repeats at a pitch of its own, which the lattice below
  // does four times across the tile, so nothing marks where one copy stops.
  paint(image, (x, y, u, v) => {
    let pixel = field

    // A lattice of diamonds across the field, and a second, coarser check over
    // the top of it so no two neighbouring motifs are quite the same colour. Both
    // periods divide the tile, so both wrap.
    const cell = 4
    const du = Math.abs(wrap(u * cell, 1) - 0.5)
    const dv = Math.abs(wrap(v * cell, 1) - 0.5)
    const diamond = du + dv
    const alternate = (Math.floor(u * cell) + Math.floor(v * cell)) % 2 === 0
    if (diamond < 0.16) pixel = mixColour(field, alternate ? cream : gold, 0.85)
    else if (diamond < 0.24) pixel = mixColour(field, alternate ? gold : cream, 0.7)
    else if (diamond < 0.3) pixel = fieldDark
    else if (Math.abs(diamond - 0.42) < 0.04) pixel = mixColour(field, gold, 0.45)
    else if (Math.abs(diamond - 0.5) < 0.03) pixel = mixColour(field, border, 0.6)

    pixel = mixColour(pixel, cream, 0.14 * clamp01((wearNoise(u, v) - 0.55) * 3))
    pixel = mixColour(pixel, fieldDark, 0.12 * (weave(u, v) - 0.5) * 2)
    return pixel
  })

  for (let i = 0; i < 4; i++) {
    stain(image, random() * image.width, random() * image.height, image.width * (0.08 + 0.1 * random()),
      i % 2 ? colour('#2f1210') : colour('#b09070'), 0.16, wobble)
  }
  // A textile is allowed more colour than a wall, so only a light chroma pull —
  // enough to say the dye has been in the sun, not enough to make it grey. No
  // grime gradient: this one lies on the floor.
  weather(image, random, { chroma: 0.16, grime: 0, bleach: 0, drift: 0.1, driftCells: 3 })
  grain(image, random, 0.035)
}

/**
 * The sky, which is one image wrapped round the world and never a tile.
 *
 * It used to be 256 square with the gradient running the full height of it, so
 * anything that repeated it — including the contact sheet — got three horizons
 * stacked up the screen. That is not a defect you tune out. A sky has exactly one
 * horizon in it and the texture has to be shaped so that it can only ever be used
 * that way: wide, so a single copy goes all the way round, and 2:1, because that
 * is the shape of a full panorama and this is mapped onto a sphere.
 *
 * `world-look.js` builds an inverted sphere and sets `wrapS` and nothing else, so
 * v runs from the zenith at 0 to the nadir at 1 and CLAMPS — vertical repetition
 * is impossible by construction — while u runs the 360 degrees and repeats. That
 * makes the horizon exactly v = 0.5, which is where it now is; before, the pale
 * hazy band was down at v = 1, under the world where nobody could see it, and the
 * actual horizon was mid-blue.
 *
 * So: dusty blue overhead, thinning as it comes down, almost white in the last
 * few degrees above the horizon where all the dust in the air is stacked up along
 * the line of sight, and a warmer ground haze below it. High cloud, thin and
 * soft, in the top half only, at a frequency that goes whole times round.
 */
function sky(image, random) {
  const haze = fractalNoise(random, 4, 2, 4)
  const cloud = fractalNoise(random, 6, 3, 4)
  const cloudEdge = periodicNoise(random, 24, 8)

  const zenith = colour('#5d7fa4')
  const upper = colour('#8ba7c0')
  const pale = colour('#c6cfd4')
  const horizon = colour('#e6e0d2')
  const ground = colour('#9c8f78')

  paint(image, (x, y, u, v) => {
    // Above the horizon the sky loses its colour all the way down; below it there
    // is only dust. The powers put the pale band tight against the horizon rather
    // than spreading it over the whole upper half, which is what makes a sky read
    // as hot rather than as a gradient.
    // How far below the horizon this row is: 0 above it, 1 at the nadir.
    const under = clamp01((v - 0.5) * 2)
    let pixel
    if (v < 0.5) {
      const down = v / 0.5
      pixel = mixColour(zenith, upper, smoothstep(clamp01(down * 1.5)))
      pixel = mixColour(pixel, pale, smoothstep(clamp01((down - 0.45) / 0.55)) ** 1.3)
      pixel = mixColour(pixel, horizon, clamp01((down - 0.88) / 0.12) ** 1.5)
    } else {
      const below = (v - 0.5) / 0.5
      pixel = mixColour(horizon, ground, smoothstep(clamp01(below * 1.4)))
    }
    // Dust does not sit in an even band; it piles up along some sightlines.
    pixel = mixColour(pixel, horizon, 0.3 * clamp01((v - 0.24) * 2.2) * (1 - under) * haze(u, v))

    // High cloud: thin, soft, and only in the upper half, thinning to nothing well
    // before the horizon so it never turns into a band lying along it.
    const height = clamp01((0.46 - v) / 0.4)
    const puff = clamp01((cloud(u, v) - 0.5) * 2.4 + 0.18 * (cloudEdge(u, v) - 0.5))
    pixel = mixColour(pixel, WHITE, 0.34 * puff * smoothstep(height))

    // A single step of dither, because a smooth gradient in eight bits bands and
    // the renderer does not filter these textures.
    const dither = ((x * 7 + y * 13) % 3 - 1) / 255
    return [pixel[0] + dither, pixel[1] + dither, pixel[2] + dither]
  })
}

// ---------------------------------------------------------------- the decals
/**
 * Decals are RGBA and are drawn on an empty field: every one of them has to fade
 * to nothing before it reaches the edge, or the quad it is drawn on will show its
 * own outline.
 */
function decalBulletHole(image, random) {
  // Both of these are sampled round a circle to give the hole and the spall an
  // uneven outline. They are deliberately low frequency: a fine noise sampled
  // that way turns a bullet hole into a sunflower.
  const edge = periodicNoise(random, 5, 5)
  const rim = periodicNoise(random, 4, 4)
  const centreX = image.width / 2
  const centreY = image.height / 2
  const hole = image.width * 0.09
  const spall = image.width * 0.2

  const dark = colour('#17120c')
  const pale = colour('#ded0b0')
  const mid = colour('#a8977a')

  paint(image, (x, y) => {
    const dx = x - centreX
    const dy = y - centreY
    const distance = Math.hypot(dx, dy)
    const angle = Math.atan2(dy, dx)
    const around = edge((Math.cos(angle) + 1) / 2, (Math.sin(angle) + 1) / 2)
    const holeRadius = hole * (0.8 + 0.4 * around)
    const spallRadius = spall * (0.78 + 0.38 * rim((Math.cos(angle) + 1) / 2, (Math.sin(angle) + 1) / 2))

    if (distance < holeRadius) {
      // The pit itself, with the far wall of it catching a little light.
      const lit = clamp01(0.2 - dy / (holeRadius * 6))
      return [...mixColour(dark, mid, lit * 0.5), 1]
    }
    if (distance < spallRadius) {
      // The spall: stone knocked pale where the round chipped it out. This ring
      // is the part that actually reads on a wall — the hole itself is small.
      const t = (distance - holeRadius) / Math.max(spallRadius - holeRadius, 0.001)
      const chip = mixColour(pale, mid, t * t)
      return [...chip, clamp01(0.95 * (1 - t) ** 0.8)]
    }
    return [0, 0, 0, 0]
  })

  // Short radial cracks running out of the impact. Long ones turn a bullet hole
  // into a spider.
  for (let i = 0; i < 6; i++) {
    const angle = random() * Math.PI * 2
    const length = spall * (0.35 + random() * 0.5)
    for (let step = 0; step < length; step++) {
      const t = step / length
      const wobbleAngle = angle + (random() - 0.5) * 0.05
      const x = centreX + Math.cos(wobbleAngle) * (hole + step)
      const y = centreY + Math.sin(wobbleAngle) * (hole + step)
      over(image, x, y, dark, 0.45 * (1 - t))
    }
  }
  // Dust thrown out around the hole.
  for (let i = 0; i < 60; i++) {
    const angle = random() * Math.PI * 2
    const distance = spall * (0.8 + random() * 1.6)
    if (distance > image.width * 0.45) continue
    over(image, centreX + Math.cos(angle) * distance, centreY + Math.sin(angle) * distance, pale, 0.35 * random())
  }
}

function decalBlood(image, random) {
  // Low frequency on purpose: sampled round a circle, a high-frequency wobble
  // gives a blob a dozen spikes and it reads as a starburst instead of a pool.
  const edge = periodicNoise(random, 5, 5)
  const centreX = image.width / 2
  const centreY = image.height / 2

  const deep = colour('#2e0908')
  const blood = colour('#4a110f')
  const thin = colour('#5e1a15')

  const blob = (x0, y0, radius, strength) => {
    const reach = Math.ceil(radius * 1.8)
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const distance = Math.hypot(dx, dy)
        const angle = Math.atan2(dy, dx)
        const shaped = radius * (0.78 + 0.4 * edge((Math.cos(angle) + 1) / 2, (Math.sin(angle) + 1) / 2))
        if (distance > shaped) continue
        const t = distance / shaped
        // Thicker in the middle, and it dries darker at the rim.
        const pixel = t > 0.82 ? mixColour(blood, thin, (t - 0.82) / 0.18) : mixColour(deep, blood, t / 0.82)
        over(image, x0 + dx, y0 + dy, pixel, strength * clamp01(1.4 - t * 0.55))
      }
    }
  }

  blob(centreX, centreY, image.width * 0.19, 1)
  for (let i = 0; i < 6; i++) {
    const angle = random() * Math.PI * 2
    const distance = image.width * (0.16 + 0.16 * random())
    blob(centreX + Math.cos(angle) * distance, centreY + Math.sin(angle) * distance, image.width * (0.02 + 0.04 * random()), 0.85)
  }
  for (let i = 0; i < 70; i++) {
    const angle = random() * Math.PI * 2
    const distance = image.width * (0.16 + 0.26 * random())
    const x = centreX + Math.cos(angle) * distance
    const y = centreY + Math.sin(angle) * distance
    if (Math.hypot(x - centreX, y - centreY) > image.width * 0.46) continue
    const radius = random() < 0.7 ? 0.8 : 1.8
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (Math.hypot(dx, dy) > radius) continue
        over(image, x + dx, y + dy, mixColour(deep, blood, random()), 0.8)
      }
    }
  }
}

function muzzleFlash(image, random) {
  const centreX = image.width / 2
  const centreY = image.height / 2
  const flicker = periodicNoise(random, 12, 12)

  const core = colour('#fffcef')
  const hot = colour('#ffd98d')
  const warm = colour('#ff9a3c')
  const smoke = colour('#c96a22')

  paint(image, (x, y) => {
    const dx = x - centreX
    const dy = y - centreY
    const distance = Math.hypot(dx, dy)
    const angle = Math.atan2(dy, dx)
    const around = 0.75 + 0.5 * flicker((Math.cos(angle) + 1) / 2, (Math.sin(angle) + 1) / 2)

    // A round glow, four long spikes and four short ones between them: the shape
    // a muzzle flash has in a sprite, not the shape it has in life.
    const glow = Math.exp(-((distance / (image.width * 0.11)) ** 2))
    const long = image.width * 0.46 * around
    const short = image.width * 0.22 * around
    const spike = axis => clamp01(1 - Math.abs(axis) / (2.2 + distance * 0.09))
    const straight = Math.max(
      spike(dy) * clamp01(1 - Math.abs(dx) / long),
      spike(dx) * clamp01(1 - Math.abs(dy) / long)
    )
    const diagonalA = (dx + dy) / Math.SQRT2
    const diagonalB = (dx - dy) / Math.SQRT2
    const diagonal = Math.max(
      spike(diagonalA) * clamp01(1 - Math.abs(diagonalB) / short),
      spike(diagonalB) * clamp01(1 - Math.abs(diagonalA) / short)
    )

    const intensity = clamp01(glow * 1.4 + straight * 0.9 + diagonal * 0.5)
    if (intensity <= 0.02) return [0, 0, 0, 0]
    let pixel = intensity > 0.75 ? mixColour(hot, core, (intensity - 0.75) / 0.25)
      : intensity > 0.4 ? mixColour(warm, hot, (intensity - 0.4) / 0.35)
        : mixColour(smoke, warm, intensity / 0.4)
    // Fade to nothing well inside the quad, so the sprite has no visible corner.
    const reach = clamp01(1 - distance / (image.width * 0.49))
    return [...pixel, clamp01(intensity * 1.1) * reach]
  })
}

// ------------------------------------------------------------------ the list
// `wrap` says which axes a texture has to join to itself on, and it is the whole
// of what separates a material from a picture.
//
//   'xy'  a material. Tiles both ways, and the seam check holds it to it.
//   'x'   a composition down its height. The trim reads from its paint edge to
//         the ground and the sky from zenith to nadir; neither may repeat
//         vertically, and neither is asked to.
//   ''    A PICTURE. Seen once, at 1:1, and it must be declared `tiling: [1, 1]`
//         in the level. The two doors are the only ones. A bare `tiling: 1` is a
//         DENSITY in this engine — one repeat per metre — so on a 1.6 by 2.4
//         metre door it draws 1.6 copies across and 2.4 up, which is a wall of
//         doors. The placements in de_dust2.json still say the bare number and
//         somebody who owns that file has to change it.
//
// Sizes are powers of two everywhere the texture repeats, because that is what a
// wrapped mip chain wants. The two 1:1 doors are the exception, and are sized at
// 160 pixels to the metre over the boxes their placements declare — 256 by 384
// for the 1.6 by 2.4 metre blue pair and 224 by 384 for the 1.4 by 2.4 metre
// steel one — so that neither is stretched. A door is a 2:3 object and a 7:12
// one; rounding either to 256 square would distort it by a third, and since
// neither ever repeats, nothing about wrapping or mip levels objects.
const TEXTURES = [
  { name: 'sand-floor', width: 256, height: 256, note: 'ground everywhere', draw: sandFloor },
  { name: 'sandstone-block', width: 256, height: 256, note: 'large dressed blocks', draw: sandstoneBlock },
  { name: 'sandstone-brick', width: 256, height: 256, note: 'smaller warm courses', draw: sandstoneBrick },
  { name: 'plaster-wall', width: 256, height: 256, note: 'render flaked to brick', draw: plasterWall },
  { name: 'plaster-trim', width: 256, height: 64, note: 'wall base band, tiles across', wrap: 'x', draw: plasterTrim },
  { name: 'crate-wood', width: 256, height: 256, note: 'crate boards, battens on the seam, no stencil', draw: crateWood },
  { name: 'door-blue', width: 256, height: 384, note: '1:1 — panelled double door, needs tiling: [1, 1]', wrap: '', draw: doorBlue },
  { name: 'door-metal', width: 224, height: 384, note: '1:1 — steel door, needs tiling: [1, 1]', wrap: '', draw: doorMetal },
  { name: 'tarp-blue', width: 128, height: 128, note: 'canvas awning', draw: tarpBlue },
  { name: 'tunnel-wall', width: 128, height: 128, note: 'darker damp stone', draw: tunnelWall },
  { name: 'tunnel-floor', width: 128, height: 128, note: 'packed dirt', draw: tunnelFloor },
  { name: 'stairs-stone', width: 256, height: 256, note: 'four worn steps', draw: stairsStone },
  { name: 'roof-tile', width: 128, height: 128, note: 'terracotta pantiles', draw: roofTile },
  { name: 'ceiling-dark', width: 128, height: 128, note: 'dark plaster overhead', draw: ceilingDark },
  { name: 'concrete', width: 256, height: 256, note: 'bomb site slab', draw: concrete },
  { name: 'rug-red', width: 256, height: 256, note: 'patterned rug', draw: rugRed },
  { name: 'metal-panel', width: 128, height: 128, note: 'corrugated sheet', draw: metalPanel },
  { name: 'sky', width: 1024, height: 512, note: 'panorama, one wrap round the world, horizon at v=0.5', wrap: 'x', draw: sky },
  { name: 'decal-bullet-hole', width: 128, height: 128, note: 'chipped impact and spall', alpha: true, draw: decalBulletHole },
  { name: 'decal-blood', width: 128, height: 128, note: 'dark splatter', alpha: true, draw: decalBlood },
  { name: 'muzzle-flash', width: 128, height: 128, note: 'four-point star', alpha: true, draw: muzzleFlash }
]

// --------------------------------------------------------------------- write
fs.mkdirSync(OUT, { recursive: true })

let failures = 0
const report = []

for (const texture of TEXTURES) {
  const { name, width, height, draw, wrap: wrapAxes = 'xy', alpha = false } = texture
  const image = surface(width, height)
  try {
    draw(image, makeRandom(seedFromName(name)))
  } catch (error) {
    console.error(`[make-counter-strike-textures] ${name}.png failed to draw: ${error.message}`)
    failures++
    continue
  }

  const file = path.join(OUT, `${name}.png`)
  const buffer = encodePng(width, height, toBytes(image))
  fs.writeFileSync(file, buffer)

  // Read it back off disk rather than trusting what was just built in memory.
  const written = fs.readFileSync(file)
  try {
    const header = decodePngHeader(written)
    if (header.width !== width || header.height !== height) {
      throw new Error(`decoded ${header.width}x${header.height}, expected ${width}x${height}`)
    }
    if (header.bitDepth !== 8 || header.colourType !== 6) {
      throw new Error(`decoded bit depth ${header.bitDepth} colour type ${header.colourType}, expected 8 and 6`)
    }
    // A texture that wraps wants a power of two on the axes it wraps on. A 1:1
    // picture never wraps, so it is held to a multiple of 32 instead — tidy, and
    // enough levels of mip to matter — and is free to be the shape of the thing
    // it is a picture of.
    const powerOfTwo = value => (value & (value - 1)) === 0
    if (wrapAxes === '') {
      if (width % 32 !== 0 || height % 32 !== 0) {
        throw new Error(`${width}x${height} is a 1:1 picture, so it must at least be a multiple of 32 on both axes`)
      }
    } else if (!powerOfTwo(width) || !powerOfTwo(height)) {
      throw new Error(`${width}x${height} wraps on "${wrapAxes}", so it must be a power of two on both axes`)
    }
  } catch (error) {
    console.error(`[make-counter-strike-textures] ${name}.png is not valid: ${error.message}`)
    failures++
    continue
  }

  const seams = { x: seamRatio(image, 'x'), y: seamRatio(image, 'y') }
  for (const axis of wrapAxes) {
    if (seams[axis] > 1.5) {
      console.error(
        `[make-counter-strike-textures] ${name}.png seams on ${axis}: the join is ${seams[axis].toFixed(2)}x ` +
        'the sharpest line inside the texture'
      )
      failures++
    }
  }

  const average = averageColour(image)
  report.push({
    name, width, height, average, alpha, wrapAxes, seams,
    bytes: written.length, note: texture.note
  })
}

// ------------------------------------------------------------------ manifest
// Printed so the next agent can pick a tint, a size and a reference string
// without opening a paint program. The reference matters: `assetURL` treats a
// bare name as living in assets/, and anything with a slash as given from
// project/ — so a texture in this folder is named "assets/counter-strike/x.png".
const totalBytes = report.reduce((sum, entry) => sum + entry.bytes, 0)
console.log('')
console.log(`${report.length} textures in project/assets/counter-strike/, ${Math.round(totalBytes / 1024)} kB in total`)
console.log('reference them as assets/counter-strike/<name>.png — a name with a slash is taken from project/')
console.log('')
console.log(
  `${'reference'.padEnd(44)}${'size'.padEnd(10)}${'average'.padEnd(10)}${'sat'.padEnd(7)}` +
  `${'tiles'.padEnd(7)}${'seam'.padEnd(15)}note`
)
for (const entry of report) {
  const seam = entry.wrapAxes === ''
    ? '1:1'
    : entry.wrapAxes.split('').map(axis => `${axis}:${entry.seams[axis].toFixed(2)}`).join(' ')
  console.log(
    `assets/counter-strike/${entry.name}.png`.padEnd(44) +
    `${entry.width}x${entry.height}`.padEnd(10) +
    entry.average.hex.padEnd(10) +
    entry.average.saturation.toFixed(2).padEnd(7) +
    (entry.wrapAxes === '' ? '1:1' : entry.wrapAxes).padEnd(7) +
    seam.padEnd(15) +
    (entry.alpha ? `RGBA ${Math.round(entry.average.coverage * 100)}% covered, ` : '') + entry.note
  )
}
console.log('')

if (failures) {
  console.error(`[make-counter-strike-textures] ${failures} problem${failures === 1 ? '' : 's'} above`)
  process.exitCode = 1
}
