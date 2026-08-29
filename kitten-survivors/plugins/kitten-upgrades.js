/**
 * Kitten Upgrades — the list of things a level-up can offer, and what taking
 * one does.
 *
 * This is the game, written down. Everything about *how* a choice is offered
 * lives in the engine — Choice Screen stops the world, Modifiers stacks the
 * stats, Experience counts the points. What is left is the part that is only
 * ever true of this game: six weapons a kitten would plausibly own, six passives
 * with numbers somebody tuned, and one line each saying what they do.
 *
 * Two rules from Vampire Survivors are kept exactly:
 *
 * - **A weapon and its upgrades are the same card.** Taking the Yarn Ball again
 *   makes it stronger. That is what makes the fourth pick of a run harder than
 *   the first, and it is why every entry carries a rank rather than a flag.
 * - **You run out of new things.** With six weapons and six passives taken, the
 *   only card left is a saucer of milk, and the run is now about surviving what
 *   you built rather than building more.
 *
 * The weapons themselves belong to another lane. This file never imports one:
 * it hands the pick to whatever the weapons lane put on `context`, and when
 * nothing is there it records the rank and says so on the bus, so a weapon that
 * arrives later picks up an arsenal that is already correct.
 */

/** How many of each kind you may carry before only upgrades are offered. */
const WEAPON_SLOTS = 6
const PASSIVE_SLOTS = 6

/**
 * The weapons. `line` is rank one — what it does at all — and `ranks` is what
 * each further pick adds, in order. Short sentences, because this is the text
 * a player reads more often than any other in the game.
 */
const WEAPONS = [
  {
    id: 'yarn-ball', name: 'Yarn Ball', glyph: '◍',
    line: 'Rolls a ball of yarn that bounces off whatever it hits.',
    ranks: ['One more ball.', '+25% damage.', 'Balls bounce for twice as long.', 'One more ball.']
  },
  {
    id: 'claw-swipe', name: 'Claw Swipe', glyph: '⌇',
    line: 'Swipes the air in front of you.',
    ranks: ['Swipes behind you too.', '+30% damage.', 'A wider arc.', 'Swipes twice.']
  },
  {
    id: 'hairball', name: 'Hairball', glyph: '●',
    line: 'Coughs a hairball at the nearest enemy.',
    ranks: ['+1 hairball.', 'Flies further.', '+25% damage.', 'Passes through one more enemy.']
  },
  {
    id: 'milk-ring', name: 'Spilt Milk', glyph: '◎',
    line: 'Leaves a pool of milk that burns whatever stands in it.',
    ranks: ['A wider pool.', 'The pool lasts longer.', '+30% damage.', 'Two pools at once.']
  },
  {
    id: 'laser-dot', name: 'Red Dot', glyph: '✷',
    line: 'A red dot circles you and scorches what it touches.',
    ranks: ['Circles faster.', '+1 dot.', '+25% damage.', 'A wider circle.']
  },
  {
    id: 'whisker-lash', name: 'Whisker Lash', glyph: '≡',
    line: 'Lashes left and right in a wide arc.',
    ranks: ['+30% damage.', 'Reaches further.', 'Lashes up and down too.', 'One more lash.']
  }
]

/**
 * The passives. `changes` is the WHOLE effect at that rank, not the step —
 * Modifiers replaces a source rather than stacking it, so rank three says
 * "thirty per cent" and the arithmetic never compounds by accident.
 *
 * `damageScale`, `areaScale` and `cooldownScale` are the three numbers the
 * weapons lane reads off the kitten. They are multipliers sitting at 1, so a
 * weapon that has never heard of this file still works.
 */
const PASSIVES = [
  {
    id: 'swift-paws', name: 'Swift Paws', glyph: '»',
    line: 'Move 10% faster.',
    changes: rank => ({ speed: { scale: 1 + 0.10 * rank } })
  },
  {
    id: 'long-whiskers', name: 'Long Whiskers', glyph: '(',
    line: 'Pick things up from 25% further away.',
    changes: rank => ({ pickupRadius: { scale: 1 + 0.25 * rank } })
  },
  {
    id: 'full-belly', name: 'Full Belly', glyph: '♥',
    line: '+20 maximum health.',
    changes: rank => ({ maxHealth: { add: 20 * rank } })
  },
  {
    id: 'quick-claws', name: 'Quick Claws', glyph: '⟳',
    line: 'Weapons come round 8% sooner.',
    changes: rank => ({ cooldownScale: { scale: Math.pow(0.92, rank) } })
  },
  {
    id: 'sharp-teeth', name: 'Sharp Teeth', glyph: '✧',
    line: 'Everything you own hits 10% harder.',
    changes: rank => ({ damageScale: { scale: 1 + 0.10 * rank } })
  },
  {
    id: 'fluffy-tail', name: 'Fluffy Tail', glyph: '◌',
    line: 'Everything you own covers 10% more ground.',
    changes: rank => ({ areaScale: { scale: 1 + 0.10 * rank } })
  }
]

/** The card that is always available, so a full build still has something to take. */
const MILK = { id: 'saucer-of-milk', kind: 'refill', name: 'Saucer of Milk', glyph: '♨', line: 'Drink 30 health back.', heal: 30 }

/** How many ranks each kind goes to. */
const MAXIMUM = { weapon: 5, passive: 5 }

const CATALOGUE = [
  ...WEAPONS.map(entry => ({ ...entry, kind: 'weapon' })),
  ...PASSIVES.map(entry => ({ ...entry, kind: 'passive' }))
]

export default {
  name: 'Kitten Upgrades',
  needs: ['Modifiers'],
  about: 'The six weapons, the six passives, and what taking one of them does.',
  inspect: context => {
    const taken = context.kittenUpgrades?.taken() || []
    return taken.length
      ? [{ title: 'Carried', rows: taken.map(entry => [entry.name, `rank ${entry.rank}`]) }]
      : [{ title: 'Carried', rows: [['nothing yet', '']] }]
  },

  onLoad(context) {
    /** id -> rank. The whole of what a run has built, and it fits in one map. */
    const ranks = new Map()

    const find = id => CATALOGUE.find(entry => entry.id === id) || (id === MILK.id ? MILK : null)
    const rankOf = id => ranks.get(id) || 0
    const carried = kind => CATALOGUE.filter(entry => entry.kind === kind && rankOf(entry.id) > 0).length

    /** What one more rank of this would say on its card. */
    function lineFor(entry, nextRank) {
      if (nextRank <= 1) return entry.line
      return entry.ranks?.[nextRank - 2] || entry.line
    }

    /**
     * Everything that could be offered right now.
     *
     * A kind you have filled every slot of stops offering NEW entries but never
     * stops offering upgrades — otherwise a run with six weapons could not
     * improve one, which is exactly when improving one matters most.
     */
    function available() {
      return CATALOGUE.filter(entry => {
        const rank = rankOf(entry.id)
        if (rank >= MAXIMUM[entry.kind]) return false
        if (rank > 0) return true
        return carried(entry.kind) < (entry.kind === 'weapon' ? WEAPON_SLOTS : PASSIVE_SLOTS)
      })
    }

    /** One card, as the Choice Screen wants it. */
    function cardFor(entry) {
      const nextRank = rankOf(entry.id) + 1
      return {
        id: entry.id,
        title: entry.name,
        glyph: entry.glyph,
        line: lineFor(entry, nextRank),
        rank: nextRank > 1 ? `Rank ${nextRank}` : 'New',
        tag: entry.kind === 'weapon' ? 'Weapon' : 'Passive',
        color: entry.kind === 'weapon' ? '#ffd166' : '#8ee6a0'
      }
    }

    /**
     * Pick `count` different things to offer.
     *
     * Drawn without replacement out of a copy, because the same card twice in
     * one row of three is the fastest way to make a choice screen look broken.
     * A saucer of milk fills any gap, so the row is always full.
     */
    function offer(count = 3) {
      const pool = available()
      const cards = []
      while (cards.length < count && pool.length) {
        const entry = context.random.pick(pool)
        pool.splice(pool.indexOf(entry), 1)
        cards.push(cardFor(entry))
      }
      while (cards.length < count) {
        cards.push({ id: MILK.id, title: MILK.name, glyph: MILK.glyph, line: MILK.line, rank: '', tag: 'Refill', color: '#9fd7ff' })
      }
      return cards
    }

    /**
     * Take one. The rank goes up first, so anything listening reads the rank it
     * is being told about rather than the one before it.
     */
    function apply(id, entity) {
      const entry = find(id)
      if (!entry) return { ok: false, reason: `nothing called "${id}" is on the list` }

      if (entry.kind === 'refill') {
        if (!entity) return { ok: false, reason: 'nobody to give it to' }
        const most = entity.properties.maxHealth ?? entity.properties.health ?? 0
        entity.properties.health = Math.min(most, (entity.properties.health ?? 0) + entry.heal)
        return { ok: true, id, healed: entry.heal }
      }

      const rank = rankOf(entry.id) + 1
      ranks.set(entry.id, rank)

      if (entry.kind === 'passive') {
        context.modifiers?.add(entity, `upgrade:${entry.id}`, entry.changes(rank))
        // A bigger belly is only worth having if it also feeds you.
        if (entry.id === 'full-belly' && entity) {
          entity.properties.health = Math.min(entity.properties.maxHealth, (entity.properties.health ?? 0) + 20)
        }
      } else {
        grantWeapon(entry, rank, entity)
      }

      context.bus.emit('kitten:upgraded', { id: entry.id, name: entry.name, kind: entry.kind, rank, entity })
      return { ok: true, id: entry.id, name: entry.name, rank }
    }

    /**
     * Hand a weapon pick to whoever owns weapons.
     *
     * Read off `context`, never imported: the weapons lane may not have loaded,
     * may name its verb `give` or `grant`, and may arrive after this plugin. So
     * every shape is tried, the rank is recorded either way, and the pick is
     * announced — a weapons plugin that boots later can read `arsenal` off the
     * kitten and be correct without anything being replayed at it.
     */
    function grantWeapon(entry, rank, entity) {
      const weapons = context.weapons
      const call = weapons?.upgrade || weapons?.levelUp || weapons?.grant || weapons?.give
      if (typeof call === 'function') {
        try { call.call(weapons, entity, entry.id, rank) }
        catch (error) { console.error(`[kitten-upgrades] the weapons lane refused ${entry.id}`, error) }
      }
      if (entity) (entity.arsenal ||= {})[entry.id] = rank
    }

    context.kittenUpgrades = {
      catalogue: () => CATALOGUE.map(entry => ({ id: entry.id, name: entry.name, kind: entry.kind, maximum: MAXIMUM[entry.kind] })),
      offer,
      apply,
      rankOf,
      available: () => available().map(entry => entry.id),
      /** What the run has built, for the HUD and the result card. */
      taken: () => CATALOGUE.filter(entry => rankOf(entry.id) > 0)
        .map(entry => ({ id: entry.id, name: entry.name, kind: entry.kind, glyph: entry.glyph, rank: rankOf(entry.id) })),
      reset: () => ranks.clear()
    }

    context.bus.on('level:loaded', () => ranks.clear())
  },

  commands: [
    { id: 'kitten.upgrades', label: 'What the kitten carries', run: context => context.kittenUpgrades.taken() },
    { id: 'kitten.offer', label: 'Three cards, as a level-up would offer them', run: context => context.kittenUpgrades.offer(3) }
  ]
}
