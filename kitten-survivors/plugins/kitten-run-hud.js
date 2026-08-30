/**
 * Kitten Run HUD — the run HUD, the marks over the actors, and the title,
 * pause and result cards. One file because they are one job: what the player
 * sees around the game, and when each of it is up.
 *
 * In a crowd of a hundred a player finds their own character by its name, its
 * health bar and the coloured ring on the floor under it, not by its
 * silhouette. The kitten wears all three, and so does anything that sets
 * `properties.nameplate`.
 *
 * Nothing here paints. Every screen is a list of plain items, and Kitten Screen
 * Look owns the item kinds and the palette — so `run screen.read` answers with
 * the words the player is looking at. The level-up cards are in
 * `kitten-progression.js`.
 *
 * Every key hint here names a key on a keyboard. The game has one input path
 * and it is a keyboard, so the interface says so on every screen rather than
 * hinting at a touch control nothing implements.
 */
import { makeProjector } from '../../engine/camera-project.js'
import { frost, DISPLAY, INK, OUTLINE, DEEP, GEM, BLOOD, GOLD, GREEN } from './kitten-screen-look.js'

/** A carried tile in the HUD corner, and how many fit on a row there. */
const TILE = 64
const PER_ROW = 8

/** The gap between two tiles, whatever size they are. */
const GAP = 10

/** The result card's own row: every upgrade in the game on one line, smaller. */
const RESULT_TILE = 56
const RESULT_ROW = 10

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
  needs: ['Screen', 'Kitten Screen Look', 'Experience', 'Run Clock', 'Kitten Upgrades'],
  about: 'The run HUD, the marks over the actors, and the title, pause and result cards.',

  onLoad(context) {
    const screen = context.screen

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

    /**
     * Tiles you can count without reading. `grow` +1 runs right and down, -1
     * left and up, and `across` is how many go on a row before the next one.
     */
    function carried(anchor, from, grow, across = PER_ROW, tile = TILE) {
      const step = tile + GAP
      return context.kittenUpgrades.taken().map((entry, index) => ({
        plate: entry.glyph,
        // The drawn picture says what the upgrade is; the character is the
        // fallback for one nobody has drawn.
        picture: entry.id,
        badge: String(entry.rank),
        // A dark tile so the picture's own colour says which kind it is.
        fill: DEEP,
        color: entry.kind === 'weapon' ? GOLD : GREEN,
        at: [from[0] + grow * (index % across) * step, from[1] + grow * Math.floor(index / across) * step],
        anchor,
        size: [tile, tile],
        textSize: Math.round(tile * 0.53)
      }))
    }

    /** Where a centred row of `count` tiles starts. */
    const rowStart = (count, across, tile) => -(Math.min(count, across) - 1) * (tile + GAP) / 2

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
          color: entity === kitten() ? GEM : GOLD
        })
      }
      return out
    }

    function drawTitle() {
      if (!titleUp) return []
      return [
        frost(0.24),
        { text: '🐾', at: [0, -180], anchor: 'center', size: 96, font: DISPLAY, baseline: 'middle', outline: false },
        { text: 'KITTEN', at: [0, -80], anchor: 'center', size: 84, weight: 900, color: GOLD, font: DISPLAY, outline: OUTLINE, baseline: 'middle' },
        { text: 'SURVIVORS', at: [0, 10], anchor: 'center', size: 84, weight: 900, color: GEM, font: DISPLAY, outline: OUTLINE, baseline: 'middle' },
        { plate: '▶ PLAY', cap: 'ANY KEY', at: [0, 170], anchor: 'center', size: [340, 120], fill: GREEN, textSize: 46 }
      ]
    }

    function drawPause() {
      if (!paused) return []
      return [
        frost(0.26),
        { text: 'II', at: [0, -170], anchor: 'center', size: 96, weight: 900, color: INK, font: DISPLAY, outline: OUTLINE, baseline: 'middle' },
        { text: 'PAUSED', at: [0, -70], anchor: 'center', size: 72, weight: 900, color: GOLD, font: DISPLAY, outline: OUTLINE, baseline: 'middle' },
        ...scoreboard(30, true),
        { plate: '▶ GO ON', cap: 'P', at: [0, 200], anchor: 'center', size: [340, 116], fill: GREEN, textSize: 42 }
      ]
    }

    /**
     * The numbers of a run, as the same plates the HUD uses, spread evenly
     * about the middle. `withClock` is false where the clock is already the
     * headline: one number twice on one screen is one number too many.
     */
    function scoreboard(y, withClock) {
      const summary = context.runClock.summary()
      const plates = withClock ? [{ plate: summary.clock, cap: '⏱' }] : []
      plates.push({ plate: String(summary.level ?? context.experience.level), cap: 'LV' })
      plates.push({ plate: String(summary.kills ?? context.progression?.kills ?? 0), cap: '☠' })
      return plates.map((plate, index) => ({
        ...plate,
        at: [(index - (plates.length - 1) / 2) * 200, y],
        anchor: 'center',
        size: [180, 100],
        textSize: 42
      }))
    }

    function drawResult() {
      const summary = context.runClock.summary()
      if (!summary.over) return []
      const died = summary.reason === 'died'
      return [
        frost(0.3),
        { panel: true, at: [0, 0], anchor: 'center', size: [760, 540], radius: 34, fill: 'rgba(11, 84, 190, 0.96)', edge: OUTLINE, edgeWidth: 8 },
        { text: died ? '☠ DOWN' : '★ SURVIVED', at: [0, -205], anchor: 'center', size: 56, weight: 900, color: died ? BLOOD : GREEN, font: DISPLAY, outline: OUTLINE, baseline: 'middle' },
        { text: summary.clock, at: [0, -110], anchor: 'center', size: 92, weight: 900, color: INK, font: DISPLAY, outline: OUTLINE, baseline: 'middle' },
        ...scoreboard(0, false),
        ...carried('center', [rowStart(context.kittenUpgrades.taken().length, RESULT_ROW, RESULT_TILE), 100], 1, RESULT_ROW, RESULT_TILE),
        { plate: '↻ AGAIN', cap: 'R', at: [0, 205], anchor: 'center', size: [340, 116], fill: GREEN, textSize: 42 }
      ]
    }

    function showTitle() {
      // Only where a player can press a key. A headless run has nobody to press
      // one, and a held clock there would make every simulation a still.
      if (typeof document === 'undefined') return { title: false }
      titleUp = true
      paused = false
      // Held whatever the loop is doing: `play:started` is emitted before the
      // loop starts, so a hold conditional on `loop.running` never takes and the
      // run plays under the card.
      context.loop.hold(TITLE_HOLD)
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
      // The card may not stand over a world it is not holding. Whatever released
      // the hold started the run, and a title over a run is two screens at once.
      if (titleUp && !context.loop.holds.includes(TITLE_HOLD)) return void start()
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
