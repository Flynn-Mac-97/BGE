/** Enemies by depth band. Numbers are floor-1 values; tuning.js grows them. Traits are named blocks below. */
export const regions = [
  { from: 1, name: 'The Cellars', line: 'Wet stone. Rats, and worse than rats.',
    normal: [
      { name: 'Cellar Rat', mark: 'r', portrait: 'cellarRat', health: 6, damage: 2, line: 'A rat the size of a dog bares yellow teeth.' },
      { name: 'Grave Robber', mark: 'x', portrait: 'graveRobber', health: 8, damage: 2, line: 'A grave robber swings a shovel at your lantern.' },
      { name: 'Venom Leech', mark: 'v', portrait: 'venomLeech', health: 7, damage: 1, traits: ['venom'], line: 'A leech drops from the ceiling, dripping green.' }
    ],
    elite: [{ name: 'Cellar Brute', mark: 'B', portrait: 'cellarBrute', health: 10, damage: 3, traits: ['armour'], line: 'The Cellar Brute lowers its head and charges.' }],
    boss: [{ name: 'The Cellar Warden', mark: 'W', portrait: 'cellarWarden', health: 12, damage: 3, traits: ['armour', 'venom'], line: 'The Cellar Warden rises from a throne of crates. The bell above it tolls once.' }] },
  { from: 11, name: 'The Crypts', line: 'Bones in the walls. Some of them move.',
    normal: [
      { name: 'Rusted Sentry', mark: 's', portrait: 'rustedSentry', health: 8, damage: 2, traits: ['armour'], line: 'A rusted sentry creaks to attention.' },
      { name: 'Venom Keeper', mark: 'k', portrait: 'venomKeeper', health: 7, damage: 2, traits: ['venom'], line: 'A venom keeper uncorks a jar of something alive.' },
      { name: 'Grave Robber', mark: 'x', portrait: 'graveRobber', health: 9, damage: 2, line: 'Another grave robber. This one brought friends; they ran.' }
    ],
    elite: [{ name: 'Grave Enforcer', mark: 'E', portrait: 'graveEnforcer', health: 11, damage: 3, traits: ['armour', 'mend'], line: 'The Grave Enforcer cracks its neck. Its wounds close as you watch.' }],
    boss: [{ name: 'The Bone Choir', mark: 'C', portrait: 'cellarWarden', health: 13, damage: 3, traits: ['venom', 'mend'], line: 'A hundred jaws sing one note. The Bone Choir fills the crypt.' }] },
  { from: 21, name: 'The Drowned Halls', line: 'Black water to the knee. Something swims under it.',
    normal: [
      { name: 'Drowned Thing', mark: 'd', portrait: 'venomLeech', health: 9, damage: 2, traits: ['mend'], line: 'A drowned thing rises, still breathing water.' },
      { name: 'Eel Witch', mark: 'e', portrait: 'venomKeeper', health: 7, damage: 2, traits: ['venom'], line: 'An eel witch hisses a curse through needle teeth.' },
      { name: 'Barnacled Knight', mark: 'n', portrait: 'rustedSentry', health: 9, damage: 2, traits: ['armour'], line: 'A knight in barnacled plate wades toward you.' }
    ],
    elite: [{ name: 'The Tide Hulk', mark: 'T', portrait: 'cellarBrute', health: 11, damage: 3, traits: ['armour', 'mend'], line: 'The Tide Hulk pulls itself out of the water, and the water follows.' }],
    boss: [{ name: 'Mother of Eels', mark: 'M', portrait: 'cellarWarden', health: 14, damage: 3, traits: ['venom', 'armour', 'mend'], line: 'The hall floods. The Mother of Eels opens every mouth at once.' }] },
  { from: 31, name: 'The Bell Foundry', line: 'Heat, brass and the smell of old prayers.',
    normal: [
      { name: 'Slag Golem', mark: 'g', portrait: 'cellarBrute', health: 10, damage: 2, traits: ['armour'], line: 'A golem of cooling slag steps off the mould.' },
      { name: 'Tolling Monk', mark: 'm', portrait: 'graveEnforcer', health: 8, damage: 2, traits: ['mend'], line: 'A monk rings a hand bell. Your ears bleed a little.' },
      { name: 'Brass Hound', mark: 'h', portrait: 'cellarRat', health: 8, damage: 3, line: 'A brass hound bays, and the foundry answers.' }
    ],
    elite: [{ name: 'The Bellwright', mark: 'R', portrait: 'graveEnforcer', health: 12, damage: 3, traits: ['armour', 'venom'], line: 'The Bellwright lifts a hammer as tall as you are.' }],
    boss: [{ name: 'The Black Bell', mark: 'K', portrait: 'cellarWarden', health: 15, damage: 4, traits: ['armour', 'venom', 'mend'], line: 'It is not a bell. It was never a bell. It rings anyway.' }] },
  { from: 41, name: 'The Hollow Below', line: 'No walls now. Only the stair, and the dark it hangs in.',
    normal: [
      { name: 'Hollow Shade', mark: 'o', portrait: 'venomLeech', health: 9, damage: 3, traits: ['venom'], line: 'A shade that wears your face steps out of the dark.' },
      { name: 'Stair Eater', mark: 'a', portrait: 'cellarBrute', health: 10, damage: 3, traits: ['armour', 'mend'], line: 'Something is eating the stair below you. It notices.' }
    ],
    elite: [{ name: 'The Last Lantern-bearer', mark: 'L', portrait: 'graveEnforcer', health: 12, damage: 3, traits: ['armour', 'venom', 'mend'], line: 'Another lantern, further down. The one holding it went down before you.' }],
    boss: [{ name: 'The Hollow King', mark: 'H', portrait: 'cellarWarden', health: 16, damage: 4, traits: ['armour', 'venom', 'mend'], line: 'The Hollow King has waited a long time. It is not impressed.' }] }
]

/** Enemy traits as grid abilities. Each reads a stat that tuning.js grows with depth. */
export const enemyTraits = {
  venom: { stat: 'venom', base: 1, ability: { id: 'venomBite', trigger: { event: 'damageDealt' }, target: { kind: 'eventTarget' }, effects: [{ type: 'applyStatus', status: 'poison', amount: { stat: 'venom' } }], limit: { perCycle: 1 } } },
  armour: { stat: 'armour', base: 1, ability: { id: 'armourUp', trigger: { event: 'cycleStart' }, target: { kind: 'self' }, effects: [{ type: 'guard', amount: { stat: 'armour' } }] } },
  mend: { stat: 'mend', base: 1, ability: { id: 'enemyMend', trigger: { event: 'cycleEnd' }, target: { kind: 'self' }, effects: [{ type: 'heal', amount: { stat: 'mend' } }] } }
}
