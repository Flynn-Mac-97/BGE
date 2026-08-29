/**
 * Kitten Run HUD — the run, read at a glance.
 *
 * Six things, and the layout is Vampire Survivors' because that layout is
 * right: the experience bar is the full width of the very top so it is the
 * first thing your eye crosses, the clock is large and centred because it is
 * the score, kills sit out of the way on the right, health sits with the
 * kitten at the bottom, and what you have picked up is a row of glyphs you can
 * count without reading.
 *
 * Nothing here paints. Every screen is a list of items handed to the Screen
 * plugin, which is also why `node bin/engine.mjs --headless run screen.read`
 * answers with the same words a player is looking at.
 */

const GEM = '#5ec8ff'
const BLOOD = '#ff6b8a'
const QUIET = 'rgba(255, 255, 255, 0.55)'

/** How many carried things fit on one row before it wraps. */
const PER_ROW = 8

export default {
  name: 'Kitten Run HUD',
  needs: ['Screen', 'Experience', 'Run Clock', 'Kitten Upgrades'],
  about: 'The experience bar, the clock, health, kills, and what the kitten has picked up.',

  onLoad(context) {
    /**
     * Only while the game is actually running.
     *
     * An always-on HUD would sit over the scene you are trying to edit, which
     * is the same reason the engine's own HUD checks this.
     */
    const playing = () => context.loop.running || context.world.simulated

    function kitten() {
      return context.progression?.kitten?.() || context.world.byId('you') || context.world.all('kitten')[0] || null
    }

    function drawHud() {
      if (!playing()) return []
      const experience = context.experience
      const run = context.runClock
      const items = []

      // The experience bar: full width, square, right at the top edge. Square
      // rather than rounded, because a bar that hugs the edge of the screen
      // with rounded ends reads as a floating pill rather than as the top of
      // the screen filling up.
      items.push({
        bar: experience.fraction,
        // The live box, not the design box: the bar has to touch both edges of
        // the window it is actually in.
        at: [0, 0], anchor: 'top', size: [context.screen.box.width, 22],
        radius: 0, color: GEM, back: 'rgba(8, 12, 20, 0.85)'
      })
      // Clear of the editor's STOP button, which sits in the same corner while
      // the game runs inside the editor.
      items.push({ text: `LV ${experience.level}`, at: [58, 3], anchor: 'top-left', size: 15, weight: 800 })
      items.push({
        text: experience.atMaximum ? 'MAX' : `${Math.floor(experience.intoLevel)} / ${experience.needed}`,
        at: [-18, 4], anchor: 'top-right', size: 14, color: QUIET
      })

      // The clock is the score in this genre, so it is the biggest thing here.
      items.push({ text: run.clock, at: [0, 34], anchor: 'top', size: 44, weight: 800 })

      items.push({ text: `☠ ${context.progression?.kills ?? 0}`, at: [-24, 46], anchor: 'top-right', size: 22, weight: 700 })

      items.push(...carried())
      items.push(...health())
      return items
    }

    /** A row of glyphs with their rank under them — countable without reading. */
    function carried() {
      const taken = context.kittenUpgrades.taken()
      return taken.flatMap((entry, index) => {
        const column = index % PER_ROW
        const row = Math.floor(index / PER_ROW)
        const x = 20 + column * 44
        const y = 96 + row * 48
        return [
          { text: entry.glyph, at: [x, y], anchor: 'top-left', size: 26, color: entry.kind === 'weapon' ? '#ffd166' : '#8ee6a0' },
          { text: String(entry.rank), at: [x + 26, y + 14], anchor: 'top-left', size: 12, color: QUIET }
        ]
      })
    }

    /** Health, down with the kitten rather than up with the numbers. */
    function health() {
      const you = kitten()
      if (!you) return []
      const most = Number(you.properties.maxHealth) || Number(you.properties.health) || 1
      const now = Math.max(0, Number(you.properties.health) || 0)
      // The number sits beside the bar on the same line rather than above it,
      // where it collided with the bar's own top edge.
      return [
        { bar: now / most, at: [24, -30], anchor: 'bottom-left', size: [280, 16], color: BLOOD },
        {
          text: `${Math.round(now)} / ${Math.round(most)}`,
          at: [316, -38], anchor: 'bottom-left', size: 14, baseline: 'middle', color: QUIET
        }
      ]
    }

    /**
     * The result card. It says how long you lasted, because that is the only
     * number anybody quotes about a run of this kind.
     */
    function drawResult() {
      const summary = context.runClock.summary()
      if (!summary.over) return []
      const died = summary.reason === 'died'
      const taken = context.kittenUpgrades.taken()

      const items = [
        { dim: 0.86 },
        { panel: true, at: [0, 0], anchor: 'center', size: [640, 400] },
        { text: died ? 'THE KITTEN IS DOWN' : 'YOU MADE IT', at: [0, -150], anchor: 'center', size: 30, weight: 800, color: died ? BLOOD : '#8ee6a0' },
        { text: 'you lasted', at: [0, -104], anchor: 'center', size: 15, color: QUIET },
        { text: summary.clock, at: [0, -62], anchor: 'center', size: 76, weight: 800 },
        { text: `Level ${summary.level ?? 1}`, at: [-110, 34], anchor: 'center', size: 20 },
        { text: `${summary.kills ?? 0} killed`, at: [110, 34], anchor: 'center', size: 20 },
        { text: 'R to try again', at: [0, 150], anchor: 'center', size: 16, color: '#ffd166' }
      ]

      // Three to a line. One long line of everything a full build carries ran
      // straight out of both sides of the panel.
      if (!taken.length) items.push({ text: 'nothing but claws', at: [0, 78], anchor: 'center', size: 14, color: QUIET })
      for (let row = 0; row * 3 < taken.length; row++) {
        items.push({
          text: taken.slice(row * 3, row * 3 + 3).map(entry => `${entry.glyph} ${entry.name} ${entry.rank}`).join('    '),
          at: [0, 74 + row * 22], anchor: 'center', size: 14, color: QUIET
        })
      }
      return items
    }

    function put() {
      context.screen.show('kitten-hud', drawHud, { order: 10 })
    }

    put()
    // Screen empties itself when a level loads, so the HUD asks to be put back.
    context.bus.on('level:loaded', () => {
      put()
      context.screen.hide('kitten-result')
    })
    context.bus.on('run:ended', () => context.screen.show('kitten-result', drawResult, { order: 90 }))
  },

  commands: [{
    id: 'kitten.hud',
    label: 'What the HUD says',
    run: context => context.screen.read()
  }]
}
