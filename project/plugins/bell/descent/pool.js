/** What the Descent can offer, and who can go down. Item types are catalog keys. */
export const descentPool = ['dagger', 'sword', 'hammer', 'buckler', 'salve', 'sprig', 'venom', 'stone', 'banner', 'hungryTooth', 'bloodCup', 'sapwoodStaff', 'thornTotem', 'blightMortar', 'sporeIdol', 'thornsapVial']

/** Consumables that can drop in the Descent; they are never on the Duel Pit shelf. */
export const consumablePool = ['mendingDraught', 'brambleWard', 'rotBloom', 'whetOil', 'smokeFlask']

/** Starting crew. `unlock` is the best depth that brings them to the Lantern; `kit` places items at [column, row]. */
export const descentCrew = {
  rook: { name: 'Rook', title: 'the Deserter', portrait: 'rook', unlock: 0, line: 'A soldier without a regiment. He knows which end of a blade to hold.', kit: [['dagger', [1, 0]], ['stone', [0, 0]]] },
  nettle: { name: 'Nettle', title: 'the Hedge Doctor', portrait: 'nettle', unlock: 0, line: 'She patches anyone who pays and most who do not.', kit: [['dagger', [1, 0]], ['salve', [0, 1]]] },
  pip: { name: 'Pip', title: 'the Failed Apprentice', portrait: 'pip', unlock: 0, line: 'Expelled for the lightning incident. Now dabbles in safer poisons.', kit: [['dagger', [1, 0]], ['venom', [0, 0]]] },
  toll: { name: 'Toll', title: 'the Hungry Bell-ringer', portrait: 'toll', unlock: 10, line: 'Something in his pocket whispers about supper.', kit: [['dagger', [1, 0]], ['hungryTooth', [2, 0]], ['bloodCup', [0, 0]]] },
  briar: { name: 'Briar', title: 'the Thorn Warden', portrait: 'antlerDruid', unlock: 15, line: 'She wants to be hit. Everything that touches her rots.', kit: [['sapwoodStaff', [0, 0]], ['thornTotem', [1, 1]], ['dagger', [2, 0]]] },
  moss: { name: 'Moss', title: 'the Pack Keeper', portrait: 'moss', unlock: 25, line: 'Arrives with a stubborn yak and too much luggage. Starts with a wider back.', columns: 1, kit: [['hammer', [1, 0]], ['banner', [0, 0]]] }
}
