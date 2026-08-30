/**
 * Kitten Screen Look — what every screen in this game is made of.
 *
 * The palette, the display face, the four item kinds Screen draws, and the
 * picture each upgrade wears. One file, because a card, a HUD tile and a result
 * plate have to read as one set: the same near-black edge, the same fat rounded
 * shape, the same colour meaning the same thing.
 *
 * Kitten Run HUD lays the HUD and the title, pause and result cards out; Kitten
 * Progression lays the level-up out. Neither paints. Both use these.
 *
 * The numbers come from `kitten-survivors/art/interface/bible.md`: bright,
 * strongly coloured, few large shapes, legible over a lit meadow.
 */

/** A wide heavy face. Screen's default is monospace, which reads as a terminal. */
export const DISPLAY = "Verdana, 'Trebuchet MS', system-ui, sans-serif"

/**
 * The palette. Read over a bright meadow, not over a dark mock-up: bright blue
 * plates, because a dark chrome HUD over mid-green grass fails `hud-is-bright`,
 * and the ruling measures the whole frame rather than one panel.
 */
export const INK = '#ffffff'
export const OUTLINE = '#0a1430'
const PLATE = '#1270f0'
export const DEEP = '#0d2352'
export const GEM = '#31cdfd'
export const BLOOD = '#ff2e55'
export const GOLD = '#ffb703'
export const GREEN = '#00e676'
export const QUIET = '#c1f4f9'

/** How thick the dark edge is. One number, so every shape reads as one set. */
const EDGE = 6

/**
 * How the world behind a menu is put back: blurred, drained, and covered by a
 * pale veil. Not darkened — a menu that multiplies the world down to near-black
 * reads as a crash, and hides the scene the player is about to go back to.
 */
const BLUR = 8
const DRAIN = 0.7
const VEIL = '#dceeff'

// ------------------------------------------------------- the upgrade pictures
/** The box a picture is built in, before it is scaled to the size asked for. */
const BOX = 100

/** Picture line thickness in box units, and how far the dark edge stands past it. */
const GLYPH_LINE = 11
const GLYPH_EDGE = 4

/** One claw mark: a bowed line leaning across. Three of them read as a swipe. */
const slash = offset => ({ path: g => { g.moveTo(offset - 26, -38); g.quadraticCurveTo(offset - 2, -4, offset + 16, 38) } })

/** One ring of a wave opening out, at `radius`. */
const ring = radius => ({ path: g => g.arc(0, 12, radius, Math.PI * 1.12, Math.PI * 1.88) })

/** One whisker, swept back from the muzzle. `side` is -1 left, 1 right. */
const whisker = (g, side, y) => { g.moveTo(side * 13, y - 3); g.quadraticCurveTo(side * 34, y, side * 47, y + 9) }

/** One toe of a paw print, as a subpath of its own so a fill closes it alone. */
const toe = (g, x, y) => { g.moveTo(x + 9, y); g.arc(x, y, 9, 0, Math.PI * 2) }

/**
 * What each upgrade looks like, keyed by the id Kitten Upgrades offers, so a
 * card and its HUD tile find the same picture without either being told.
 *
 * A character is not a picture: `◌` does not say "fluffy tail" and `(` does not
 * say "long whiskers". A part is `{ path, fill }`, stroked twice — wide in the
 * dark edge, then in the upgrade's own colour.
 */
const PICTURES = {
  'claw dart': [slash(-24), slash(2), slash(28)],

  // One winding stroke, kept inside the ball, and one thread leaving it. Two
  // crossed strokes merge at tile size and the ball reads as a barred circle.
  'yarn ball': [
    { path: g => { g.moveTo(24, -10); g.arc(-6, -10, 30, 0, Math.PI * 2) } },
    { path: g => { g.moveTo(-24, -22); g.bezierCurveTo(8, -15, -16, 2, 13, 7) } },
    { path: g => { g.moveTo(13, 17); g.bezierCurveTo(38, 26, 22, 46, 3, 35) } }
  ],

  'purr wave': [
    { path: g => { g.moveTo(7, 12); g.arc(0, 12, 7, 0, Math.PI * 2) }, fill: true },
    ring(21), ring(34), ring(47)
  ],

  hairball: [
    { path: g => { g.moveTo(25, 4); g.arc(0, 4, 25, 0, Math.PI * 2) }, fill: true },
    {
      path: g => {
        for (let tuft = 0; tuft < 6; tuft++) {
          const angle = tuft / 6 * Math.PI * 2
          g.moveTo(Math.cos(angle) * 24, 4 + Math.sin(angle) * 24)
          g.lineTo(Math.cos(angle) * 43, 4 + Math.sin(angle) * 43)
        }
      }
    }
  ],

  // Toes clear of each other and of the pad: a fill is stroked as well, so two
  // shapes closer than the line is wide come out as one lump.
  'swift-paws': [
    { path: g => { g.moveTo(35, 18); g.ellipse(8, 18, 27, 20, 0, 0, Math.PI * 2) }, fill: true },
    { path: g => { toe(g, -22, -24); toe(g, 8, -32); toe(g, 38, -22) }, fill: true },
    { path: g => { g.moveTo(-52, 4); g.lineTo(-38, 4); g.moveTo(-52, 30); g.lineTo(-34, 30) } }
  ],

  'long-whiskers': [
    { path: g => { g.moveTo(-11, -9); g.lineTo(11, -9); g.lineTo(0, 6); g.closePath() }, fill: true },
    { path: g => { whisker(g, -1, -17); whisker(g, -1, 1); whisker(g, -1, 19) } },
    { path: g => { whisker(g, 1, -17); whisker(g, 1, 1); whisker(g, 1, 19) } }
  ],

  'full-belly': [
    { path: g => { g.moveTo(0, 36); g.bezierCurveTo(-48, 5, -31, -32, 0, -13); g.bezierCurveTo(31, -32, 48, 5, 0, 36) }, fill: true }
  ],

  'quick-claws': [
    { path: g => g.arc(0, 2, 42, Math.PI * 0.5, Math.PI * 1.78) },
    { path: g => { g.moveTo(-2, 54); g.lineTo(23, 40); g.lineTo(27, 60); g.closePath() }, fill: true },
    { path: g => { g.moveTo(-16, -22); g.quadraticCurveTo(2, 0, -10, 24) } },
    { path: g => { g.moveTo(12, -22); g.quadraticCurveTo(26, 0, 14, 24) } }
  ],

  'sharp-teeth': [
    { path: g => { g.moveTo(-42, -24); g.lineTo(42, -24) } },
    { path: g => { g.moveTo(-31, -22); g.lineTo(-12, -22); g.lineTo(-21, 32); g.closePath() }, fill: true },
    { path: g => { g.moveTo(12, -22); g.lineTo(31, -22); g.lineTo(21, 32); g.closePath() }, fill: true }
  ],

  'fluffy-tail': [
    {
      path: g => {
        g.moveTo(-33, 45)
        g.bezierCurveTo(-53, -10, -6, -47, 31, -29)
        g.bezierCurveTo(-1, -21, -19, 2, -13, 45)
        g.closePath()
      },
      fill: true
    }
  ],

  'saucer-of-milk': [
    { path: g => { g.moveTo(-44, 4); g.quadraticCurveTo(0, 46, 44, 4); g.closePath() }, fill: true },
    { path: g => { g.moveTo(-31, 2); g.quadraticCurveTo(0, 16, 31, 2) } },
    { path: g => { g.moveTo(0, -42); g.quadraticCurveTo(11, -27, 0, -21); g.quadraticCurveTo(-11, -27, 0, -42) }, fill: true }
  ]
}

/**
 * Draw one upgrade's picture, centred on `x, y` and `size` across. Answers
 * false when the upgrade has no picture, so the caller falls back to a
 * character rather than leaving the tile empty.
 */
export function drawGlyph(g, id, x, y, size, colour, edge = OUTLINE) {
  const parts = PICTURES[id]
  if (!parts) return false

  g.save()
  g.translate(x, y)
  g.scale(size / BOX, size / BOX)
  g.lineCap = 'round'
  g.lineJoin = 'round'
  // Every edge first, then every colour: a part drawn late must not cut its own
  // dark edge out of the part beside it. A picture asked for in the edge colour
  // skips the edge, or every line comes out three times its weight.
  const passes = colour === edge
    ? [{ width: GLYPH_LINE, paint: colour }]
    : [{ width: GLYPH_LINE + GLYPH_EDGE * 2, paint: edge }, { width: GLYPH_LINE, paint: colour }]
  for (const pass of passes) {
    g.lineWidth = pass.width
    g.strokeStyle = pass.paint
    g.fillStyle = pass.paint
    for (const part of parts) {
      g.beginPath()
      part.path(g)
      if (part.fill) g.fill()
      g.stroke()
    }
  }
  g.restore()
  return true
}

// -------------------------------------------------------------- the item kinds
/** Dark-outlined text. What keeps white legible over bright grass. */
export function outlined(g, text, x, y, size, colour) {
  g.lineWidth = Math.max(3, size / 5)
  g.lineJoin = 'round'
  g.strokeStyle = OUTLINE
  g.strokeText(text, x, y)
  g.fillStyle = colour
  g.fillText(text, x, y)
}

/**
 * A copy of the world picture, kept while the world is held.
 *
 * Copied rather than read when a menu paints: a WebGL drawing buffer reads back
 * empty once the browser has composited it, and a menu paints only when its
 * items change. `version` counts the copies, so a menu that carries it repaints
 * on every new one.
 */
const worldPicture = { canvas: null, version: 0 }

/** The item a menu puts behind itself. `of` is what makes it repaint. */
export const frost = amount => ({ frost: amount, of: worldPicture.version })

/**
 * Take this frame's world picture, if the world is held. Never cleared first:
 * a buffer that reads back empty draws nothing, and the last good copy is
 * better than a blank one.
 */
function keepWorldPicture(context) {
  if (typeof document === 'undefined' || !context.loop.paused) return
  const world = context.shell?.viewport?.querySelector('#gl')
  if (!world?.width) return
  const copy = worldPicture.canvas || (worldPicture.canvas = document.createElement('canvas'))
  if (copy.width !== world.width || copy.height !== world.height) {
    copy.width = world.width
    copy.height = world.height
  }
  copy.getContext('2d').drawImage(world, 0, 0)
  worldPicture.version++
}

/**
 * The world behind a menu: blurred, drained, and covered by a pale veil.
 *
 * The copy is drawn at full opacity, so the sharp picture underneath is covered
 * rather than ghosted. With no copy to be had, the veil alone still lifts the
 * frame instead of crushing it.
 */
function drawFrost(g, item, screen) {
  const { width, height } = screen.box
  if (worldPicture.canvas?.width) {
    g.save()
    g.filter = `blur(${BLUR}px) saturate(${DRAIN})`
    g.drawImage(worldPicture.canvas, 0, 0, width, height)
    g.restore()
  }
  g.fillStyle = item.color || VEIL
  g.globalAlpha = item.frost
  g.fillRect(0, 0, width, height)
  g.globalAlpha = 1
}

/**
 * A plate: a fat rounded tile with a heavy dark edge, one big number, picture
 * or glyph, a cap above and a badge in the corner. Every fixed thing on screen
 * is one.
 */
function drawPlate(g, item, screen) {
  const size = item.size || [96, 96]
  const [x, y] = screen.boxAt(item, size)
  screen.roundedRect(g, x, y, size[0], size[1], item.radius ?? 22)
  g.fillStyle = item.fill || PLATE
  g.fill()
  g.lineWidth = item.edgeWidth ?? EDGE
  g.strokeStyle = OUTLINE
  g.stroke()

  const middle = x + size[0] / 2
  g.textAlign = 'center'
  if (item.cap != null) {
    g.font = `800 ${item.capSize || 20}px ${DISPLAY}`
    g.textBaseline = 'top'
    g.fillStyle = item.capColor || OUTLINE
    g.fillText(String(item.cap), middle, y + 9)
  }

  const textSize = item.textSize || 40
  const centre = y + size[1] / 2 + (item.cap != null ? 12 : 0)
  // A picture says what an upgrade is. The character is the fallback for an
  // upgrade nobody has drawn, and for every plate that is a number.
  if (!drawGlyph(g, item.picture, middle, centre, textSize * 1.55, item.color || INK)) {
    g.font = `900 ${textSize}px ${DISPLAY}`
    g.textBaseline = 'middle'
    outlined(g, String(item.plate), middle, centre, textSize, item.color || INK)
  }
  if (item.badge != null) badge(g, x + size[0] - 4, y + size[1] - 4, item.badge, item.color || INK)
}

function badge(g, x, y, text, colour) {
  g.beginPath()
  g.arc(x, y, 15, 0, Math.PI * 2)
  g.fillStyle = OUTLINE
  g.fill()
  g.font = `900 18px ${DISPLAY}`
  g.fillStyle = colour
  g.fillText(String(text), x, y + 1)
}

const describePlate = item =>
  [`${item.cap != null ? `${item.cap} ` : ''}${item.plate}${item.badge != null ? ` ${item.badge}` : ''}`]

/** A meter. The label goes inside: a number beside a bar is a second thing to find. */
function drawMeter(g, item, screen) {
  const size = item.size || [420, 34]
  const [x, y] = screen.boxAt(item, size)
  fillMeter(g, screen, x, y, size, clamp(item.meter), item.color || GEM, item.radius ?? size[1] / 2, item.edgeWidth ?? EDGE, item.back)
  if (!item.label) return
  const textSize = item.labelSize || Math.round(size[1] * 0.55)
  g.font = `900 ${textSize}px ${DISPLAY}`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  outlined(g, String(item.label), x + size[0] / 2, y + size[1] / 2 + 1, textSize, INK)
}

/** Track, edge and fill. Shared, because a mark's health bar is the same shape. */
function fillMeter(g, screen, x, y, size, part, colour, radius, edge, back) {
  screen.roundedRect(g, x, y, size[0], size[1], radius)
  g.fillStyle = back || OUTLINE
  g.fill()
  g.lineWidth = edge
  g.strokeStyle = OUTLINE
  g.stroke()

  const inside = [x + edge, y + edge, size[0] - edge * 2, size[1] - edge * 2]
  const filled = inside[2] * part
  // A sliver still has to read as a bar, so the fill keeps its round ends.
  if (filled <= 0.5) return
  g.save()
  screen.roundedRect(g, inside[0], inside[1], inside[2], inside[3], Math.max(0, radius - edge))
  g.clip()
  const width = Math.max(filled, inside[3])
  screen.roundedRect(g, inside[0], inside[1], width, inside[3], Math.max(0, radius - edge))
  g.fillStyle = colour
  g.fill()
  // A pale band along the top makes a flat bar read as moulded.
  g.globalAlpha = 0.32
  g.fillStyle = INK
  g.fillRect(inside[0], inside[1], width, inside[3] * 0.36)
  g.globalAlpha = 1
  g.restore()
}

/**
 * A mark: a ring on the floor under an actor, its name above the head and a
 * health bar under the name. Given in screen coordinates, already projected.
 */
function drawMark(g, item, screen) {
  const width = Math.max(28, item.width || 40)
  const colour = item.color || GEM

  if (item.foot) {
    g.beginPath()
    g.ellipse(item.foot[0], item.foot[1], width / 2, width / 4.4, 0, 0, Math.PI * 2)
    g.globalAlpha = 0.22
    g.fillStyle = colour
    g.fill()
    g.globalAlpha = 1
    g.lineWidth = 4
    g.strokeStyle = colour
    g.stroke()
  }

  const barWidth = Math.max(58, width)
  const [x, y] = [item.at[0] - barWidth / 2, item.at[1]]
  fillMeter(g, screen, x, y, [barWidth, 13], clamp(item.mark.health), GREEN, 6, 3)

  g.font = `900 15px ${DISPLAY}`
  g.textAlign = 'center'
  g.textBaseline = 'bottom'
  outlined(g, String(item.mark.name), item.at[0], y - 4, 15, colour)
}

const clamp = value => Math.max(0, Math.min(1, Number(value) || 0))
const percent = value => `${Math.round(clamp(value) * 100)}%`

export default {
  name: 'Kitten Screen Look',
  needs: ['Screen'],
  about: 'The palette, the display face, the four item kinds every kitten screen is drawn from, and the picture each upgrade wears.',
  inspect: () => [{ title: 'Upgrade pictures', rows: Object.keys(PICTURES).map(id => [id, 'drawn']) }],

  onLoad(context) {
    const screen = context.screen
    screen.painter('frost', { draw: drawFrost, describe: () => [] })
    screen.painter('plate', { draw: drawPlate, describe: describePlate })
    screen.painter('meter', { draw: drawMeter, describe: item => [`${item.name || 'meter'} ${percent(item.meter)}`] })
    screen.painter('mark', { draw: drawMark, describe: item => [`${item.mark.name} ${percent(item.mark.health)}`] })
    context.kittenLook = { drawGlyph, outlined, frost, pictures: () => Object.keys(PICTURES) }
  },

  // Frame, because it only copies a picture. Nothing here changes the game.
  systems: [{ phase: 'frame', run: (world, seconds, context) => keepWorldPicture(context) }],

  commands: [
    { id: 'kitten.glyphs', label: 'Which upgrades have a picture', run: () => Object.keys(PICTURES) }
  ]
}
