/**
 * Kitten Run HUD — what the player sees: the run HUD, the marks over the
 * actors, and the title, pause and result cards. One file because they share
 * one look, fixed by `kitten-survivors/art/interface/bible.md`.
 *
 * In a crowd of a hundred a player finds their own character by its name, its
 * health bar and the coloured ring on the floor under it, not by its
 * silhouette. The kitten wears all three, and so does anything that sets
 * `properties.nameplate`.
 *
 * Nothing here paints directly: three item kinds go into Screen through
 * `screen.painter`, so `run screen.read` answers with the words the player is
 * looking at. The level-up cards are in `kitten-progression.js`.
 */
import { makeProjector } from '../../engine/camera-project.js'

/** A wide heavy face. Screen's default is monospace, which reads as a terminal. */
const DISPLAY = "Verdana, 'Trebuchet MS', system-ui, sans-serif"

// Per the bible, read over a bright meadow rather than a dark mock-up.
const INK = '#ffffff'
const OUTLINE = '#0a1430'
// Bright blue plates, because a dark chrome HUD over a mid-green meadow fails
// `hud-is-bright` — the ruling measures the whole frame, not one panel.
const PLATE = '#1270f0'
const DEEP = '#0d2352'
const GEM = '#31cdfd'
const BLOOD = '#ff2e55'
const WEAPON = '#ffb703'
const PASSIVE = '#00e676'

/** How thick the dark edge is. One number, so every shape reads as one set. */
const EDGE = 6

/** A carried tile, the step between two, and how many fit on a row. */
const TILE = 64
const STEP = TILE + 10
const PER_ROW = 8

/** Metres above and below an actor's origin its mark is drawn at, and the ring across. */
const HEAD = 0.62, FEET = 0.24, RING = 1.1

/** Keys that start a run from the title card. Any of them: it is "press anything". */
const START_KEYS = ['Space', 'Enter', 'NumpadEnter', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Digit1']

/** Why the world is stopped, in a word a snapshot can print. */
const TITLE_HOLD = 'kitten-title'
const PAUSE_HOLD = 'kitten-paused'

/** The live key reader, published so the declared system reaches this world's own. */
export const runHud = { tick: null }

export default {
  name: 'Kitten Run HUD',
  needs: ['Screen', 'Experience', 'Run Clock', 'Kitten Upgrades'],
  about: 'The run HUD, the marks over the actors, and the title, pause and result cards.',

  onLoad(context) {
    const screen = context.screen
    screen.painter('plate', { draw: drawPlate, describe: describePlate })
    screen.painter('meter', { draw: drawMeter, describe: item => [`${item.name || 'meter'} ${percent(item.meter)}`] })
    screen.painter('mark', { draw: drawMark, describe: item => [`${item.mark.name} ${percent(item.mark.health)}`] })

    let titleUp = false
    let paused = false

    const kitten = () =>
      context.progression?.kitten?.() || context.world.byId('you') || context.world.all('kitten')[0] || null

    /** Only while the game runs. An always-on HUD sits over the scene being edited. */
    const playing = () => context.loop.running || context.world.simulated

    function drawHud() {
      // Down while a card is being chosen or the result is up: both put their
      // own title where the clock is, and both repeat these numbers.
      if (!playing() || titleUp || context.choiceScreen?.isOpen || context.runClock.over) return []
      const experience = context.experience
      const you = kitten()
      const most = Number(you?.properties.maxHealth) || Number(you?.properties.health) || 1
      const now = Math.max(0, Number(you?.properties.health) || 0)

      const items = [
        // Wider than the box and lifted above it, so the edge shows only along
        // the bottom and the bar bleeds off both sides. Its track is pale: a
        // near-black band the full width of the screen drags the frame dark.
        { meter: experience.fraction, name: 'experience', at: [-8, -8], anchor: 'top', size: [screen.box.width + 16, 46], radius: 0, color: GEM, back: 'rgba(236, 245, 255, 0.62)' },
        // Clear of the editor's STOP button, in this corner while play runs.
        { plate: String(experience.level), cap: 'LV', at: [58, 34], anchor: 'top-left', size: [92, 92], textSize: 42 },
        // The clock is the score in this genre, so it is the biggest thing here.
        { plate: context.runClock.clock, at: [0, 34], anchor: 'top', size: [230, 88], textSize: 54 },
        { plate: String(context.progression?.kills ?? 0), cap: '☠', at: [-24, 34], anchor: 'top-right', size: [150, 88], textSize: 40 }
      ]
      if (you) items.push({ meter: now / most, name: 'health', at: [24, -26], anchor: 'bottom-left', size: [470, 46], color: BLOOD, label: `♥ ${Math.round(now)} / ${Math.round(most)}` })
      items.push(...carried('bottom-right', [-24, -24], -1), ...marks())
      return items
    }

    /** Tiles you can count without reading. `grow` +1 runs right and down, -1 left and up. */
    function carried(anchor, from, grow) {
      return context.kittenUpgrades.taken().map((entry, index) => ({
        plate: entry.glyph,
        badge: String(entry.rank),
        // A dark tile so the glyph's own colour says which kind it is.
        fill: DEEP,
        color: entry.kind === 'weapon' ? WEAPON : PASSIVE,
        at: [from[0] + grow * (index % PER_ROW) * STEP, from[1] + grow * Math.floor(index / PER_ROW) * STEP],
        anchor,
        size: [TILE, TILE],
        textSize: 34
      }))
    }

    /** Where a centred row of `count` tiles starts. */
    const rowStart = count => -(Math.min(count, PER_ROW) - 1) * STEP / 2

    /** The name an actor wears, or nothing if it wears none. */
    const nameOf = entity => entity.properties?.nameplate || (entity === kitten() ? 'YOU' : null)

    /**
     * A name plate over each named actor and a ring under it. Positions come
     * from the kernel projector, so a mark lands where the renderer draws.
     */
    function marks() {
      if (!context.view || !context.viewport) return []
      const projector = makeProjector(context.view, context.viewport)
      const box = screen.box
      const out = []
      for (const entity of context.world.entities) {
        const name = nameOf(entity)
        if (!name) continue
        const head = projector.place(entity.x, entity.y + HEAD, entity.z || 0)
        if (!head.inFront) continue
        const feet = projector.place(entity.x, entity.y - FEET, entity.z || 0)
        const most = Number(entity.properties?.maxHealth) || Number(entity.properties?.health) || 1
        out.push({
          mark: { name, health: (Number(entity.properties?.health) || 0) / most },
          at: [head.x * box.width / 100, head.y * box.height / 100],
          foot: [feet.x * box.width / 100, feet.y * box.height / 100],
          width: projector.sizeAt(feet.depth, RING, RING).w * box.width / 100,
          color: entity === kitten() ? GEM : WEAPON
        })
      }
      return out
    }

    function drawTitle() {
      if (!titleUp) return []
      return [
        { dim: 0.62 },
        { text: '🐾', at: [0, -180], anchor: 'center', size: 96, font: DISPLAY, baseline: 'middle', outline: false },
        { text: 'KITTEN', at: [0, -80], anchor: 'center', size: 84, weight: 900, color: WEAPON, font: DISPLAY, outline: OUTLINE, baseline: 'middle' },
        { text: 'SURVIVORS', at: [0, 10], anchor: 'center', size: 84, weight: 900, color: GEM, font: DISPLAY, outline: OUTLINE, baseline: 'middle' },
        { plate: '▶ PLAY', cap: 'ANY KEY', at: [0, 170], anchor: 'center', size: [340, 120], fill: PASSIVE, textSize: 46 }
      ]
    }

    function drawPause() {
      if (!paused) return []
      return [
        { dim: 0.7 },
        { text: 'II', at: [0, -170], anchor: 'center', size: 96, weight: 900, color: INK, font: DISPLAY, outline: OUTLINE, baseline: 'middle' },
        { text: 'PAUSED', at: [0, -70], anchor: 'center', size: 72, weight: 900, color: WEAPON, font: DISPLAY, outline: OUTLINE, baseline: 'middle' },
        ...scoreboard(30),
        { plate: '▶ GO ON', cap: 'P', at: [0, 200], anchor: 'center', size: [340, 116], fill: PASSIVE, textSize: 42 }
      ]
    }

    /** The three numbers of a run, as the same plates the HUD uses. */
    function scoreboard(y) {
      const summary = context.runClock.summary()
      return [
        { plate: summary.clock, cap: '⏱', at: [-190, y], anchor: 'center', size: [190, 100], textSize: 42 },
        { plate: String(summary.level ?? context.experience.level), cap: 'LV', at: [0, y], anchor: 'center', size: [150, 100], textSize: 42 },
        { plate: String(summary.kills ?? context.progression?.kills ?? 0), cap: '☠', at: [190, y], anchor: 'center', size: [190, 100], textSize: 42 }
      ]
    }

    function drawResult() {
      const summary = context.runClock.summary()
      if (!summary.over) return []
      const died = summary.reason === 'died'
      return [
        { dim: 0.86 },
        { panel: true, at: [0, 0], anchor: 'center', size: [760, 540], radius: 34, fill: 'rgba(11, 84, 190, 0.96)', edge: OUTLINE, edgeWidth: 8 },
        { text: died ? '☠ DOWN' : '★ SURVIVED', at: [0, -205], anchor: 'center', size: 56, weight: 900, color: died ? BLOOD : PASSIVE, font: DISPLAY, outline: OUTLINE, baseline: 'middle' },
        { text: summary.clock, at: [0, -110], anchor: 'center', size: 92, weight: 900, color: INK, font: DISPLAY, outline: OUTLINE, baseline: 'middle' },
        ...scoreboard(0),
        ...carried('center', [rowStart(context.kittenUpgrades.taken().length), 92], 1),
        { plate: '↻ AGAIN', cap: 'R', at: [0, 205], anchor: 'center', size: [340, 116], fill: PASSIVE, textSize: 42 }
      ]
    }

    function showTitle() {
      titleUp = true
      paused = false
      // Held only where a player can press a key. A headless run has nobody to
      // press one, and a held clock there would make every simulation a still.
      if (context.loop.running) context.loop.hold(TITLE_HOLD)
      screen.show('kitten-title', drawTitle, { order: 80 })
      return { title: true }
    }

    function start() {
      titleUp = false
      context.loop.release(TITLE_HOLD)
      screen.hide('kitten-title')
      return { title: false }
    }

    function pause(on = !paused) {
      if (context.runClock.over || context.choiceScreen?.isOpen || titleUp) return { paused }
      paused = !!on
      if (paused) context.loop.hold(PAUSE_HOLD)
      else context.loop.release(PAUSE_HOLD)
      return { paused }
    }

    context.kittenScreens = {
      showTitle, start, pause,
      get titleUp() { return titleUp },
      get paused() { return paused }
    }

    context.input?.bind('kittenStart', START_KEYS)
    context.input?.bind('kittenPause', ['KeyP', 'Escape'])

    function put() {
      screen.show('kitten-hud', drawHud, { order: 10 })
      screen.show('kitten-pause', drawPause, { order: 85 })
    }

    put()
    // Screen empties itself when a level loads, so the HUD asks to be put back.
    context.bus.on('level:loaded', () => {
      put()
      screen.hide('kitten-result')
      paused = false
      titleUp = false
    })
    context.bus.on('play:started', showTitle)
    context.bus.on('play:stopped', () => { titleUp = false; paused = false })
    context.bus.on('run:ended', () => { paused = false; screen.show('kitten-result', drawResult, { order: 90 }) })

    // One press, acted on once: `pressed` stays true across every fixed step of
    // a frame, so the marks are cleared on the keyboard's own event.
    const spent = new Set()
    context.bus.on('step:end', () => spent.clear())

    runHud.tick = () => {
      if (!context.input) return
      if (titleUp && context.input.pressed('kittenStart') && !spent.has('start')) {
        spent.add('start')
        return void start()
      }
      if (context.input.pressed('kittenPause') && !spent.has('pause')) {
        spent.add('pause')
        pause()
      }
    }
  },

  // Fixed, because starting and pausing change the game and must land on the
  // same step on every replay.
  systems: [{ phase: 'fixed', run: () => runHud.tick?.() }],

  commands: [
    { id: 'kitten.hud', label: 'What the screen says', run: context => context.screen.read() },
    { id: 'kitten.title', label: 'Put the title card up', run: context => context.kittenScreens.showTitle() },
    { id: 'kitten.start', label: 'Take the title card down and run', run: context => context.kittenScreens.start() },
    { id: 'kitten.pause', label: 'Pause or unpause', run: context => context.kittenScreens.pause() }
  ]
}

const clamp = value => Math.max(0, Math.min(1, Number(value) || 0))
const percent = value => `${Math.round(clamp(value) * 100)}%`

/**
 * A plate: a fat rounded tile with a heavy dark edge, one big number or glyph,
 * a cap above and a badge in the corner. Every fixed thing on screen is one.
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
  g.font = `900 ${textSize}px ${DISPLAY}`
  g.textBaseline = 'middle'
  outlined(g, String(item.plate), middle, y + size[1] / 2 + (item.cap != null ? 12 : 0), textSize, item.color || INK)
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
  fillMeter(g, screen, x, y, [barWidth, 13], clamp(item.mark.health), PASSIVE, 6, 3)

  g.font = `900 15px ${DISPLAY}`
  g.textAlign = 'center'
  g.textBaseline = 'bottom'
  outlined(g, String(item.mark.name), item.at[0], y - 4, 15, colour)
}

/** Dark-outlined text. What keeps white legible over bright grass. */
function outlined(g, text, x, y, size, colour) {
  g.lineWidth = Math.max(3, size / 5)
  g.lineJoin = 'round'
  g.strokeStyle = OUTLINE
  g.strokeText(text, x, y)
  g.fillStyle = colour
  g.fillText(text, x, y)
}
