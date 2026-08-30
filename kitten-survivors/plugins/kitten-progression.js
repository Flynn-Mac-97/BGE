/**
 * Kitten Progression — the loop that makes a run a run.
 *
 * Something dies, it leaves a gem, the gem flies to the kitten, the bar fills,
 * the world stops and you choose. That wiring is all this file does, plus the
 * cards the choice is made on.
 *
 * The lanes it depends on may not exist yet, so none of them is imported and
 * none is required:
 *
 * - **The horde** announces a death. Several names are listened for, and
 *   `context.progression.enemyDied(entity)` is the plain door if none fits.
 * - **The weapons lane** is handed picks by Kitten Upgrades, off `context`.
 * - **The kitten** is whatever is called `you`, then whatever type is `kitten`,
 *   then whoever the camera follows.
 *
 * What it puts on `context` for the other lanes:
 *
 *   context.progression.stats()   { damage, area, cooldown, speed, pickupRadius, maxHealth }
 *   the kitten's properties       damageScale, areaScale, cooldownScale — all seeded at 1
 *
 * Choice Screen keeps the queue, the hold on the world and the keys; its own
 * card row comes down and `kitten-level-up` goes up, so the cards match the
 * rest of the interface. The look is `art/interface/bible.md`.
 */
import { drawGlyph, outlined, frost, DISPLAY, INK, OUTLINE, QUIET, GOLD, GREEN } from './kitten-screen-look.js'

/**
 * The curve. Five points for the first level, five more each time up to level
 * twenty, then a flatter climb.
 *
 * A gem is worth one, so the first level-up is five kills and arrives in the
 * first few seconds. By level twenty a level is twenty kills, and the run has
 * turned into a defence of what you already built.
 */
const CURVE = level => (level <= 20 ? 5 * level : 100 + (level - 20) * 12)

/** What a gem looks like at each worth. Blue is one kill, red is a boss's worth. */
const GEM_TIERS = [
  { from: 25, tint: '#ff6b8a', size: 0.34 }, { from: 5, tint: '#8ee6a0', size: 0.27 }, { from: 0, tint: '#5ec8ff', size: 0.22 }
]

/** How far the kitten reaches for a gem before any upgrade widens it. */
const PICKUP_RADIUS = 2.2

/** Death is announced under several names. Any of them is a kill. */
const DEATH_EVENTS = ['enemy:died', 'enemy:killed', 'entity:died', 'damage:died', 'damage:killed']

/** One card, the gap between two, and how far above the middle the row sits. */
const CARD = { width: 320, height: 340, gap: 34, margin: 80, radius: 28, band: 120, row: 54 }

/** The live wiring, published so the declared systems reach this world's own. */
export const progression = { tick: null }

export default {
  name: 'Kitten Progression',
  // Kitten Screen Look registers the `plate` and `frost` painters this screen
  // is built from, and owns the palette the cards share with the HUD.
  needs: ['Experience', 'Pickups', 'Choice Screen', 'Screen', 'Run Clock', 'Modifiers', 'Kitten Upgrades', 'Kitten Screen Look'],
  about: 'Gems from the dead, a bar that fills, and a level-up that stops the world and offers three cards.',
  inspect: context => [{
    title: 'This run',
    rows: [
      ['level', String(context.experience?.level ?? 1)],
      ['kills', String(context.progression?.kills ?? 0)],
      ['clock', context.runClock?.clock ?? '0:00']
    ]
  }],

  onLoad(context) {
    let kills = 0

    /**
     * The kitten. Looked up fresh every time and checked against the world, so
     * nothing here can end up acting on an entity from the last run.
     */
    function kitten() {
      const named = context.world.byId('you')
      if (named) return named
      const first = context.world.all('kitten')[0]
      if (first) return first
      const followed = context.camera?.target
      return followed && context.world.entities.includes(followed) ? followed : null
    }

    /**
     * The three multipliers and the pickup radius have to exist before an
     * upgrade multiplies them. Modifiers takes whatever it finds as the base,
     * and a scale whose base is zero stays zero however many times you take it.
     */
    function seed(entity) {
      if (!entity) return
      const properties = entity.properties
      properties.damageScale ??= 1
      properties.areaScale ??= 1
      properties.cooldownScale ??= 1
      properties.pickupRadius ??= PICKUP_RADIUS
    }

    /** What every other lane should read instead of guessing at upgrades. */
    function stats() {
      const properties = kitten()?.properties || {}
      return {
        damage: properties.damageScale ?? 1,
        area: properties.areaScale ?? 1,
        cooldown: properties.cooldownScale ?? 1,
        speed: properties.speed ?? 0,
        pickupRadius: properties.pickupRadius ?? PICKUP_RADIUS,
        maxHealth: properties.maxHealth ?? 0,
        health: properties.health ?? 0
      }
    }

    /** A gem worth `value`, where the thing died. Bigger and redder as it is worth more. */
    function dropGem(at, value = 1) {
      const tier = GEM_TIERS.find(t => value >= t.from) || GEM_TIERS[GEM_TIERS.length - 1]
      if (!context.pickups) return null
      return context.pickups.drop(
        'xp-gem',
        // Lifted off the floor, or the gem sits inside the grass and cannot be seen.
        [at[0] ?? 0, (at[1] ?? 0) + 0.3, at[2] ?? 0],
        { pickup: 'experience', value },
        { mesh: { box: [tier.size, tier.size, tier.size], tint: tier.tint } }
      )
    }

    /**
     * Something the kitten killed. One kill, one gem, worth whatever the thing
     * declared it was worth.
     */
    function enemyDied(entity) {
      if (!entity) return null
      kills++
      const worth = Number(entity.properties?.experience) || 1
      return dropGem([entity.x, entity.y, entity.z], worth)
    }

    // Every shape a death might be announced in, reduced to an entity.
    const asEntity = payload => {
      if (!payload) return null
      if (payload.id && payload.properties) return payload
      return payload.entity || payload.victim || payload.target || null
    }
    for (const name of DEATH_EVENTS) context.bus.on(name, payload => enemyDied(asEntity(payload)))

    // A gem is worth points. This is the one line that says so, and it is the
    // reason Pickups never has to know what "experience" means.
    context.bus.on('pickup:collected', ({ kind, value }) => {
      if (kind === 'experience') context.experience?.gain(value, 'gem')
    })

    /**
     * A level is a choice. Three cards, and the world stops until one is taken.
     * Levels queue inside Choice Screen, so three at once is three choices.
     */
    context.bus.on('experience:levelled', ({ level }) => {
      context.choiceScreen?.offer({
        title: 'LEVEL UP',
        subtitle: `Level ${level}`,
        options: context.kittenUpgrades.offer(3),
        onPick: option => context.kittenUpgrades.apply(option.id, kitten())
      })
    })

    context.screen.painter('kittenCard', { draw: drawCard, describe: describeCard })

    /** The cards, read from Choice Screen's own view so every way in still works. */
    function drawLevelUp() {
      const shown = context.choiceScreen?.view()
      if (!shown?.open) return []
      const count = shown.options.length
      const width = Math.min(CARD.width, (context.screen.box.width - CARD.margin * 2 - CARD.gap * (count - 1)) / Math.max(count, 1))

      const items = [
        frost(0.26),
        { text: shown.title, at: [0, 48], anchor: 'top', size: 64, weight: 900, color: GOLD, font: DISPLAY, outline: OUTLINE },
        { plate: String(context.experience.level), cap: 'LV', at: [0, 126], anchor: 'top', size: [124, 90], textSize: 42, capColor: GOLD }
      ]
      shown.options.forEach((option, index) => items.push({
        kittenCard: option,
        // Every card on one baseline. The chosen one is ringed rather than
        // moved, so nothing under the reading eye shifts as the pick changes.
        at: [(index - (count - 1) / 2) * (width + CARD.gap), CARD.row],
        anchor: 'center',
        size: [width, CARD.height],
        selected: index === shown.selected
      }))
      // The same action plate every other screen ends with, and its cap names
      // the keys. This game is played on a keyboard and says so everywhere.
      items.push({
        plate: '▶ TAKE ONE',
        cap: shown.options.map((_, index) => index + 1).join(' '),
        at: [0, -24], anchor: 'bottom', size: [320, 92], fill: GREEN, textSize: 38
      })
      if (shown.waiting) items.push({ plate: `+${shown.waiting}`, at: [-24, -24], anchor: 'bottom-right', size: [110, 92], textSize: 36, color: GOLD })
      return items
    }

    // `choice:offered` is emitted after Choice Screen shows its own card row,
    // so hiding it here wins.
    context.bus.on('choice:offered', () => {
      context.screen.hide('choice-screen')
      context.screen.show('kitten-level-up', drawLevelUp, { order: 100 })
    })
    context.bus.on('choice:closed', () => context.screen.hide('kitten-level-up'))

    // Health is capped by a bigger belly, and Modifiers may have just raised it.
    context.bus.on('modifiers:changed', ({ entity }) => {
      if (!entity?.properties) return
      const most = entity.properties.maxHealth
      if (most != null && entity.properties.health > most) entity.properties.health = most
    })

    // The run ends when the kitten does, and a card offered to a dead kitten is
    // a world held still with nobody left to answer.
    context.runClock?.watch(kitten)
    context.runClock?.report('kills', () => kills)
    context.runClock?.report('level', () => context.experience.level)
    context.runClock?.report('carried', () => context.kittenUpgrades.taken().map(entry => `${entry.name} ${entry.rank}`))
    context.bus.on('run:ended', () => context.choiceScreen?.cancel())

    context.progression = {
      stats,
      dropGem,
      enemyDied,
      kitten,
      get kills() { return kills },
      get level() { return context.experience.level }
    }

    // Curve and collector are set once the world exists, and again on every
    // level load, because a fresh level clears both.
    function arm() {
      kills = 0
      context.experience?.configure({ curve: CURVE, maxLevel: 99 })
      if (context.pickups) context.pickups.collector = kitten
      seed(kitten())
      context.world.state.kills = 0
    }
    arm()
    context.bus.on('level:loaded', arm)

    // R plays again once the run is over. Reloading the level is the whole
    // restart: it clears the world, resets the clock and the random stream, and
    // every plugin here empties itself on `level:loaded`.
    context.input?.bind('kittenRestart', ['KeyR'])
    const spent = new Set()
    context.bus.on('step:end', () => spent.clear())

    progression.tick = () => {
      context.world.state.kills = kills
      if (!context.runClock?.over) return
      if (!context.input?.pressed('kittenRestart') || spent.has('restart')) return
      spent.add('restart')
      // Loading is asynchronous inside a fixed step, so an unhandled rejection
      // would be a restart that silently did nothing.
      context.editor.loadLevel(context.level())
        // Straight back in: a player who asked to play again answered the title.
        .then(() => context.kittenScreens?.start())
        .catch(error => console.error('[kitten-progression] could not restart the level', error))
    }
  },

  systems: [{
    // Fixed, because restarting is a change to the game.
    phase: 'fixed',
    run: () => progression.tick?.()
  }],

  commands: [
    {
      id: 'kitten.progress',
      label: 'Level, kills and clock',
      run: context => ({
        level: context.experience.level,
        experience: `${context.experience.intoLevel}/${context.experience.needed}`,
        kills: context.progression.kills,
        clock: context.runClock?.clock ?? '0:00',
        carried: context.kittenUpgrades.taken(),
        stats: context.progression.stats()
      })
    },
    {
      id: 'kitten.drop',
      label: 'Drop a gem on the kitten, worth n',
      // args: how much it is worth. For trying the magnet without an enemy.
      run: (context, args) => {
        const worth = Number([].concat(args ?? [])[0] ?? 1)
        const you = context.progression.kitten()
        const at = you ? [you.x + 3, you.y, you.z] : [3, 0.3, 0]
        return { id: context.progression.dropGem(at, worth).id, worth }
      }
    }
  ]
}

/**
 * One level-up card: a fat rounded panel with a heavy dark edge, a coloured
 * head band carrying the glyph, then the name, the rank and one line. The
 * number is a badge on the band, because the number is what a thumb presses.
 */
function drawCard(g, item, screen) {
  const card = item.kittenCard || {}
  const size = item.size || [CARD.width, CARD.height]
  const [x, y] = screen.boxAt(item, size)
  const colour = card.color || GOLD

  screen.roundedRect(g, x, y, size[0], size[1], CARD.radius)
  g.fillStyle = 'rgba(9, 21, 74, 0.96)'
  g.fill()

  g.save()
  screen.roundedRect(g, x, y, size[0], size[1], CARD.radius)
  g.clip()
  g.fillStyle = colour
  g.fillRect(x, y, size[0], CARD.band)
  g.restore()

  screen.roundedRect(g, x, y, size[0], size[1], CARD.radius)
  g.lineWidth = item.selected ? 10 : 6
  g.strokeStyle = item.selected ? INK : OUTLINE
  g.stroke()

  if (item.selected) {
    // Outside the card's own box, so the mark that says "this one" cannot move
    // the row it is marking.
    screen.roundedRect(g, x - 9, y - 9, size[0] + 18, size[1] + 18, CARD.radius + 9)
    g.lineWidth = 6
    g.strokeStyle = 'rgba(255, 255, 255, 0.42)'
    g.stroke()
  }

  const middle = x + size[0] / 2
  const bandMiddle = y + CARD.band / 2 + 4
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  // Near-black on the coloured band: the band already carries the card's
  // colour, so a picture in that colour would read only by its outline.
  if (!drawGlyph(g, card.id, middle, bandMiddle, 88, OUTLINE)) {
    g.font = `400 72px ${DISPLAY}`
    outlined(g, String(card.glyph ?? ''), middle, bandMiddle, 72, colour)
  }

  if (card.number != null) {
    g.beginPath()
    g.arc(x + 34, y + 34, 24, 0, Math.PI * 2)
    g.fillStyle = OUTLINE
    g.fill()
    g.font = `900 27px ${DISPLAY}`
    g.fillStyle = INK
    g.fillText(String(card.number), x + 34, y + 35)
  }

  if (card.tag) {
    g.font = `800 15px ${DISPLAY}`
    g.fillStyle = OUTLINE
    g.fillText(String(card.tag).toUpperCase(), x + size[0] - 56, y + 26)
  }

  let cursor = y + CARD.band + 42
  g.font = `900 30px ${DISPLAY}`
  outlined(g, String(card.title ?? ''), middle, cursor, 30, INK)
  cursor += 40

  if (card.rank) {
    g.font = `900 19px ${DISPLAY}`
    outlined(g, String(card.rank).toUpperCase(), middle, cursor, 19, colour)
    cursor += 34
  }

  g.font = `700 18px ${DISPLAY}`
  g.fillStyle = QUIET
  for (const line of wrap(g, card.line, size[0] - 44)) {
    g.fillText(line, middle, cursor)
    cursor += 26
  }
}

/** What a card reads as. The chosen one is marked, because that is the question. */
function describeCard(item) {
  const card = item.kittenCard || {}
  const out = [`${item.selected ? '> ' : '  '}${card.number ?? ''}. ${card.title ?? ''}`.trimEnd()]
  if (card.rank) out.push(`    ${card.rank}`)
  if (card.line) out.push(`    ${card.line}`)
  return out
}

/** Break a line that does not fit, so a card written in prose still fits its card. */
function wrap(g, line, width) {
  const out = []
  let current = ''
  for (const word of String(line || '').split(/\s+/).filter(Boolean)) {
    const next = current ? `${current} ${word}` : word
    if (current && g.measureText(next).width > width) { out.push(current); current = word }
    else current = next
  }
  if (current) out.push(current)
  return out
}
