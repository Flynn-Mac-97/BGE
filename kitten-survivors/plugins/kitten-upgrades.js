/**
 * Kitten Upgrades — the list of things a level-up can offer, and what taking
 * one does.
 *
 * This is the game, written down. How a choice is offered belongs to the
 * engine — Choice Screen stops the world, Modifiers stacks the kitten's stats,
 * Experience counts the points. What is left is only ever true of this game:
 * the four weapons a kitten fights with, six passives with tuned numbers, and
 * one line each saying what they do.
 *
 * Two rules from Vampire Survivors are kept exactly:
 *
 * - **A weapon and its upgrades are the same card.** The first pick of a weapon
 *   arms you with it; every pick after that changes one of its numbers. That is
 *   why an entry carries a rank rather than a flag.
 * - **You run out of new things.** With every weapon and passive at rank five
 *   the only card left is a saucer of milk, and the run is about surviving what
 *   you built.
 *
 * **Every card here changes a number, and this file is where that is enforced.**
 * A weapon card folds its `changes` into `weapon.stats` through Auto Weapons —
 * the one bag a weapon fires from. A passive changes the kitten's properties
 * through Modifiers, and the three that make weapons better also fold into
 * every weapon carried now and every weapon picked later. A card whose effect
 * is not one of those two things is a card that does nothing.
 */

/** The weapon ids are the names Auto Weapons was given in Kitten Weapons. */
const WEAPONS = [
  {
    id: 'claw dart', name: 'Claw Dart', glyph: '✧',
    line: 'Throws a claw at whatever is nearest.',
    ranks: [
      { line: 'One more dart.', changes: { count: '+1' } },
      { line: '+30% damage.', changes: { damage: '*1.3' } },
      { line: 'Thrown a third faster, and through one more body.', changes: { cooldown: '*0.75', pierce: '+1' } },
      { line: 'One more dart, and each one harder.', changes: { count: '+1', damage: '*1.25' } }
    ]
  },
  {
    id: 'yarn ball', name: 'Yarn Ball', glyph: '◍',
    line: 'Balls of yarn circle you and hurt what walks into them.',
    ranks: [
      { line: 'Two more balls.', changes: { count: '+2' } },
      { line: 'They last half again as long.', changes: { duration: '*1.5' } },
      { line: '+40% damage.', changes: { damage: '*1.4' } },
      { line: 'Two more balls, on a wider ring.', changes: { count: '+2', area: '*1.25' } }
    ]
  },
  {
    id: 'purr wave', name: 'Purr Wave', glyph: '◎',
    line: 'A ring sweeps out from where you stand and knocks the crowd back.',
    ranks: [
      { line: 'It reaches 40% further.', changes: { area: '*1.4' } },
      { line: 'It comes round a third sooner.', changes: { cooldown: '*0.75' } },
      { line: '+35% damage.', changes: { damage: '*1.35' } },
      { line: 'A second ring follows the first.', changes: { count: '+1' } }
    ]
  },
  {
    id: 'hairball', name: 'Hairball', glyph: '●',
    line: 'Coughed back over your shoulder, and it bursts.',
    ranks: [
      { line: '+35% damage.', changes: { damage: '*1.35' } },
      { line: 'A 40% wider burst.', changes: { area: '*1.4' } },
      { line: 'Two at a time.', changes: { count: '+1' } },
      { line: 'Coughed up 30% more often.', changes: { cooldown: '*0.7' } }
    ]
  }
]

/**
 * The passives. `changes` is the WHOLE effect at that rank, not the step —
 * Modifiers replaces a source rather than stacking it, so rank three says
 * "thirty per cent" and the arithmetic never compounds by accident.
 *
 * `weaponStep` is the other half, and it works the other way round: it is one
 * rank's worth of change to a weapon, folded into every weapon carried at the
 * time and re-applied once per rank to any weapon picked later. Auto Weapons
 * fires from `weapon.stats` and reads nothing off the owner, so a passive that
 * only wrote a multiplier onto the kitten would change no weapon at all.
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
    line: '+20 maximum health, and 20 back now.',
    changes: rank => ({ maxHealth: { add: 20 * rank } })
  },
  {
    id: 'quick-claws', name: 'Quick Claws', glyph: '⟳',
    line: 'Every weapon comes round 8% sooner.',
    changes: rank => ({ cooldownScale: { scale: Math.pow(0.92, rank) } }),
    weaponStep: { cooldown: '*0.92' }
  },
  {
    id: 'sharp-teeth', name: 'Sharp Teeth', glyph: '⚔',
    line: 'Every weapon hits 10% harder.',
    changes: rank => ({ damageScale: { scale: Math.pow(1.10, rank) } }),
    weaponStep: { damage: '*1.1' }
  },
  {
    id: 'fluffy-tail', name: 'Fluffy Tail', glyph: '◌',
    line: 'Every weapon covers 10% more ground.',
    changes: rank => ({ areaScale: { scale: Math.pow(1.10, rank) } }),
    weaponStep: { area: '*1.1' }
  }
]

/** The card that is always available, so a full build still has something to take. */
const MILK = { id: 'saucer-of-milk', kind: 'refill', name: 'Saucer of Milk', glyph: '♨', line: 'Drink 30 health back.', heal: 30 }

// Colours per kitten-survivors/art/interface/bible.md: saturation.p95 >= 0.73.
// Matches Kitten Run HUD's carried-icon colours, so a card and the icon it
// leaves on the HUD read as the same thing.
const WEAPON_COLOR = '#ffb703'
const PASSIVE_COLOR = '#00e676'
const MILK_COLOR = '#3ec8ff'

/** How many ranks each kind goes to. A weapon has one rank per line in `ranks`, plus the pick that arms it. */
const MAXIMUM = { weapon: 5, passive: 5 }

const CATALOGUE = [
  ...WEAPONS.map(entry => ({ ...entry, kind: 'weapon' })),
  ...PASSIVES.map(entry => ({ ...entry, kind: 'passive' }))
]

/** How much health a Full Belly hands over on the spot. Matches its `changes`. */
const BELLY_HEAL = 20

export default {
  name: 'Kitten Upgrades',
  // Kitten Weapons must load first: it arms the kitten on `level:loaded`, and
  // the rank map is seeded from what the kitten is already holding.
  needs: ['Modifiers', 'Auto Weapons', 'Kitten Weapons'],
  about: 'The four weapons, the six passives, and the number each one changes.',
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
    const player = () => context.world.byId('you')

    /** What one more rank of this would say on its card. */
    function lineFor(entry, nextRank) {
      if (nextRank <= 1) return entry.line
      return entry.ranks?.[nextRank - 2]?.line || entry.line
    }

    /** Everything that could be offered right now. */
    function available() {
      return CATALOGUE.filter(entry => rankOf(entry.id) < MAXIMUM[entry.kind])
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
        color: entry.kind === 'weapon' ? WEAPON_COLOR : PASSIVE_COLOR
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
        cards.push({ id: MILK.id, title: MILK.name, glyph: MILK.glyph, line: MILK.line, rank: '', tag: 'Refill', color: MILK_COLOR })
      }
      return cards
    }

    /**
     * Take one. The rank goes up first, so anything listening reads the rank it
     * is being told about rather than the one before it.
     */
    function apply(id, entity = player()) {
      const entry = find(id)
      if (!entry) return { ok: false, reason: `nothing called "${id}" is on the list` }

      if (entry.kind === 'refill') {
        if (!entity) return { ok: false, reason: 'nobody to give it to' }
        const most = entity.properties.maxHealth ?? entity.properties.health ?? 0
        entity.properties.health = Math.min(most, (entity.properties.health ?? 0) + entry.heal)
        return { ok: true, id, healed: entry.heal, health: entity.properties.health }
      }

      if (rankOf(entry.id) >= MAXIMUM[entry.kind]) {
        return { ok: false, reason: `${entry.name} is already at rank ${MAXIMUM[entry.kind]}` }
      }

      const rank = rankOf(entry.id) + 1
      ranks.set(entry.id, rank)
      const stats = entry.kind === 'passive'
        ? takePassive(entry, rank, entity)
        : takeWeapon(entry, rank, entity)

      context.bus.emit('kitten:upgraded', { id: entry.id, name: entry.name, kind: entry.kind, rank, entity, stats })
      return { ok: true, id: entry.id, name: entry.name, kind: entry.kind, rank, stats }
    }

    /** A passive changes the kitten, and the three weapon passives change the weapons too. */
    function takePassive(entry, rank, entity) {
      context.modifiers?.add(entity, `upgrade:${entry.id}`, entry.changes(rank))
      if (entry.id === 'full-belly' && entity) {
        entity.properties.health = Math.min(entity.properties.maxHealth, (entity.properties.health ?? 0) + BELLY_HEAL)
      }
      if (entry.weaponStep && entity) {
        for (const weapon of context.autoWeapons.carriedBy(entity)) {
          context.autoWeapons.upgrade(entity, weapon.name, entry.weaponStep)
        }
      }
      return entity ? { ...entity.properties } : null
    }

    /** Rank one arms the kitten with it; every rank after changes its numbers. */
    function takeWeapon(entry, rank, entity) {
      if (!entity) return null
      if (rank > 1) return context.autoWeapons.levelUp(entity, entry.id, entry.ranks[rank - 2]?.changes || {})

      const weapon = context.autoWeapons.give(entity, entry.id)
      if (!weapon) return null
      // A weapon picked after a passive has to catch up on it, or the order the
      // cards happened to come out in would decide how strong the build is.
      for (const passive of PASSIVES) {
        if (!passive.weaponStep) continue
        for (let step = rankOf(passive.id); step > 0; step--) {
          context.autoWeapons.upgrade(entity, entry.id, passive.weaponStep)
        }
      }
      return context.autoWeapons.of(entity, entry.id)?.stats || null
    }

    /**
     * A run starts with whatever Kitten Weapons armed the kitten with, so those
     * weapons are already at rank one and their card must offer rank two.
     */
    function begin() {
      ranks.clear()
      const you = player()
      if (!you) return
      for (const weapon of context.autoWeapons.carriedBy(you)) {
        if (CATALOGUE.some(entry => entry.id === weapon.name)) ranks.set(weapon.name, 1)
      }
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
      reset: begin
    }

    begin()
    context.bus.on('level:loaded', begin)
  },

  commands: [
    { id: 'kitten.upgrades', label: 'What the kitten carries', run: context => context.kittenUpgrades.taken() },
    { id: 'kitten.offer', label: 'Three cards, as a level-up would offer them', run: context => context.kittenUpgrades.offer(3) },
    {
      id: 'kitten.take',
      label: 'Take one upgrade by id, and say what number it changed',
      /** `run kitten.take '"sharp-teeth"'` — the whole catalogue is in `kitten.offer`. */
      run: (context, args) => context.kittenUpgrades.apply(String([].concat(args ?? [])[0] || ''))
    }
  ]
}
