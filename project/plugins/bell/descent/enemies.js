import { tuning } from './tuning.js'

/** Enemies by depth band. Numbers are floor-1 values; tuning.js grows them. Traits are named blocks below. */
export const regions = [
  { from: 1, name: 'The Cellars', line: 'Wet stone. Rats, and worse than rats.',
    normal: [
      { name: 'Cellar Rat', mark: 'r', portrait: 'cellarRat', health: 6, damage: 2, traits: ['swarm'], line: 'A rat the size of a dog bares yellow teeth.' },
      { name: 'Grave Robber', mark: 'x', portrait: 'graveRobber', health: 8, damage: 2, traits: ['heavyBlow'], line: 'A grave robber swings a shovel at your lantern.' },
      { name: 'Venom Leech', mark: 'v', portrait: 'venomLeech', health: 7, damage: 1, traits: ['venom'], line: 'A leech drops from the ceiling, dripping green.' }
    ],
    elite: [{ name: 'Cellar Brute', mark: 'B', portrait: 'cellarBrute', health: 10, damage: 3, traits: ['heavyBlow', 'plated'], line: 'The Cellar Brute lowers its head and charges.' }],
    boss: [{ name: 'The Cellar Warden', mark: 'W', portrait: 'cellarWarden', health: 12, damage: 3, traits: ['plated', 'heavyBlow', 'venom'], line: 'The Cellar Warden rises from a throne of crates. The bell above it tolls once.' }] },
  { from: 11, name: 'The Crypts', line: 'Bones in the walls. Some of them move.',
    normal: [
      { name: 'Rusted Sentry', mark: 's', portrait: 'rustedSentry', health: 8, damage: 2, traits: ['plated'], line: 'A rusted sentry creaks to attention.' },
      { name: 'Venom Keeper', mark: 'k', portrait: 'venomKeeper', health: 7, damage: 2, traits: ['venom'], line: 'A venom keeper uncorks a jar of something alive.' },
      { name: 'Grave Robber', mark: 'x', portrait: 'graveRobber', health: 9, damage: 2, traits: ['heavyBlow'], line: 'Another grave robber. This one brought friends; they ran.' }
    ],
    elite: [{ name: 'Grave Enforcer', mark: 'E', portrait: 'graveEnforcer', health: 11, damage: 3, traits: ['plated', 'regrowth'], line: 'The Grave Enforcer cracks its neck. Its wounds close as you watch.' }],
    boss: [{ name: 'The Bone Choir', mark: 'C', portrait: 'cellarWarden', health: 13, damage: 3, traits: ['swarm', 'venom', 'purifier'], line: 'A hundred jaws sing one note. The Bone Choir fills the crypt.' }] },
  { from: 21, name: 'The Drowned Halls', line: 'Black water to the knee. Something swims under it.',
    normal: [
      { name: 'Drowned Thing', mark: 'd', portrait: 'venomLeech', health: 9, damage: 2, traits: ['regrowth'], line: 'A drowned thing rises, still breathing water.' },
      { name: 'Eel Witch', mark: 'e', portrait: 'venomKeeper', health: 7, damage: 2, traits: ['purifier'], line: 'An eel witch hisses a curse through needle teeth.' },
      { name: 'Barnacled Knight', mark: 'n', portrait: 'rustedSentry', health: 9, damage: 2, traits: ['spiked'], line: 'A knight in barnacled plate wades toward you.' }
    ],
    elite: [{ name: 'The Tide Hulk', mark: 'T', portrait: 'cellarBrute', health: 11, damage: 3, traits: ['heavyBlow', 'regrowth'], line: 'The Tide Hulk pulls itself out of the water, and the water follows.' }],
    boss: [{ name: 'Mother of Eels', mark: 'M', portrait: 'cellarWarden', health: 14, damage: 3, traits: ['swarm', 'purifier', 'regrowth'], line: 'The hall floods. The Mother of Eels opens every mouth at once.' }] },
  { from: 31, name: 'The Bell Foundry', line: 'Heat, brass and the smell of old prayers.',
    normal: [
      { name: 'Slag Golem', mark: 'g', portrait: 'cellarBrute', health: 10, damage: 2, traits: ['plated'], line: 'A golem of cooling slag steps off the mould.' },
      { name: 'Tolling Monk', mark: 'm', portrait: 'graveEnforcer', health: 8, damage: 2, traits: ['purifier'], line: 'A monk rings a hand bell. Your ears bleed a little.' },
      { name: 'Brass Hound', mark: 'h', portrait: 'cellarRat', health: 8, damage: 3, traits: ['swarm'], line: 'A brass hound bays, and the foundry answers.' }
    ],
    elite: [{ name: 'The Bellwright', mark: 'R', portrait: 'graveEnforcer', health: 12, damage: 3, traits: ['heavyBlow', 'spiked'], line: 'The Bellwright lifts a hammer as tall as you are.' }],
    boss: [{ name: 'The Black Bell', mark: 'K', portrait: 'cellarWarden', health: 15, damage: 4, traits: ['heavyBlow', 'plated', 'purifier'], line: 'It is not a bell. It was never a bell. It rings anyway.' }] },
  { from: 41, name: 'The Hollow Below', line: 'No walls now. Only the stair, and the dark it hangs in.',
    normal: [
      { name: 'Hollow Shade', mark: 'o', portrait: 'venomLeech', health: 9, damage: 3, traits: ['spiked'], line: 'A shade that wears your face steps out of the dark.' },
      { name: 'Stair Eater', mark: 'a', portrait: 'cellarBrute', health: 10, damage: 3, traits: ['regrowth'], line: 'Something is eating the stair below you. It notices.' }
    ],
    elite: [{ name: 'The Last Lantern-bearer', mark: 'L', portrait: 'graveEnforcer', health: 12, damage: 3, traits: ['purifier', 'heavyBlow'], line: 'Another lantern, further down. The one holding it went down before you.' }],
    boss: [{ name: 'The Hollow King', mark: 'H', portrait: 'cellarWarden', health: 16, damage: 4, traits: ['heavyBlow', 'spiked', 'regrowth'], line: 'The Hollow King has waited a long time. It is not impressed.' }] }
]

/**
 * Enemy traits as grid abilities, with the words the stage shows. Each reads a stat that tuning.js grows with depth.
 * The threats (heavyBlow, plated, purifier, swarm, regrowth, spiked) each ask for a different answer from a build.
 */
export const enemyTraits = {
  venom: { stat: 'venom', base: 1, name: 'Venom', text: 'Its hits poison you.', ability: { id: 'venomBite', trigger: { event: 'damageDealt' }, target: { kind: 'eventTarget' }, effects: [{ type: 'applyStatus', status: 'poison', amount: { stat: 'venom' } }], limit: { perCycle: 1 } } },
  armour: { stat: 'armour', base: 1, name: 'Armour', text: 'Gains a little guard each cycle.', ability: { id: 'armourUp', trigger: { event: 'cycleStart' }, target: { kind: 'self' }, effects: [{ type: 'guard', amount: { stat: 'armour' } }] } },
  mend: { stat: 'mend', base: 1, name: 'Mend', text: 'Heals a little each cycle.', ability: { id: 'enemyMend', trigger: { event: 'cycleEnd' }, target: { kind: 'self' }, effects: [{ type: 'heal', amount: { stat: 'mend' } }] } },
  heavyBlow: { stat: 'heavy', base: 5, name: 'Heavy Blow', text: 'Every 2nd cycle it lands a huge hit. Sap, Smoke and guard blunt it.', ability: { id: 'heavyBlow', trigger: { event: 'ownTurn' }, target: { kind: 'enemy' }, conditions: [{ kind: 'cycleEvery', amount: 2 }], effects: [{ type: 'damage', amount: { stat: 'heavy' } }] } },
  plated: { stat: 'plate', base: 7, name: 'Plated', text: 'Thick guard that regrows each cycle. Strip it, or go through it.', ability: { id: 'plating', trigger: { event: 'cycleStart' }, target: { kind: 'self' }, effects: [{ type: 'guard', amount: { stat: 'plate' } }] } },
  purifier: { stat: 'purify', base: 4, name: 'Purifier', text: 'On its turn it washes off Poison, Bleed, Burn, Shock and Curse before they can hurt it. Hit it directly.', ability: { id: 'purify', trigger: { event: 'ownTurn' }, target: { kind: 'self' }, effects: ['poison', 'bleed', 'burn', 'shock', 'curse'].map(status => ({ type: 'removeStatus', status, amount: { stat: 'purify' } })) } },
  swarm: { stat: 'swarm', base: 0.5, name: 'Swarm', text: 'Strikes three extra small blows each turn. Thorns and anything that wakes when you are hit love it.', ability: { id: 'swarmBites', trigger: { event: 'ownTurn' }, target: { kind: 'enemy' }, effects: [1, 2, 3].map(() => ({ type: 'damage', amount: { stat: 'swarm' } })) } },
  regrowth: { stat: 'regrow', base: 5, name: 'Regrowth', text: 'Heals a lot each cycle. Bleed, Curse and burst damage beat it.', ability: { id: 'regrowth', trigger: { event: 'cycleEnd' }, target: { kind: 'self' }, effects: [{ type: 'heal', amount: { stat: 'regrow' } }] } },
  spiked: { stat: 'spikes', base: 0.6, name: 'Spiked', text: 'Each time it is hit, spikes hurt you. Few big hits beat many small ones.', ability: { id: 'spikes', trigger: { event: 'damageTaken', target: { kind: 'self' } }, target: { kind: 'enemy' }, effects: [{ type: 'damage', amount: { stat: 'spikes' } }], limit: { perCycle: 4 } } }
}

/** Every foe tires in a long fight: from cycle `tuning.enemy.tire.from` it loses `tire.share` of its health each cycle, through guard. A build that cannot kill it can still outlast it. */
export const tireAbility = { id: 'tire', trigger: { event: 'cycleStart' }, target: { kind: 'self' }, conditions: [{ kind: 'cycleAtLeast', amount: tuning.enemy.tire.from }], effects: [{ type: 'damage', amount: { stat: 'tire' }, bypassGuard: true }] }
