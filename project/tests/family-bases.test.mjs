/** Every family base item does its job in a real fight: each fires its ability, and dice replay the same. */
import { defineSuite } from '../tools/node-suite.mjs'
import assert from 'node:assert/strict'
import { rules } from '../plugins/bell/rules.js'
import { familyBaseItems } from '../plugins/bell/catalog/family-bases.js'
import { familyOf } from '../plugins/bell/power-families.js'
const { test, suite } = defineSuite('Family base items')
export default suite

// The Rusty Dagger stands at [1,0] in every test fight; [0,0] is to its left, [2,0] to its right, [0,1] below [0,0].
const left = [0, 0], right = [2, 0], belowLeft = [0, 1]

/** Each item's test fight: the kit beside the dagger, and anything the fight must start with. */
const setups = {
  handAxe: { kit: [['handAxe', right]] },
  battleAxe: { kit: [['battleAxe', right]] },
  halberd: { kit: [['halberd', right]] },
  flail: { kit: [['flail', right]] },
  throwingKnife: { kit: [['throwingKnife', right]] },
  towerShield: { kit: [['towerShield', left]] },
  ironHelm: { kit: [['ironHelm', right]] },
  plateGlove: { kit: [['plateGlove', left]] },
  honeycomb: { kit: [['honeycomb', right]] },
  feather: { kit: [['feather', right]] },
  breadLoaf: { kit: [['breadLoaf', right]] },
  waterSkin: { kit: [['waterSkin', right]], recruit: { statuses: { poison: { stacks: 5, duration: 'combat', expires: null, source: null } } } },
  bedroll: { kit: [['bedroll', right]] },
  cheeseWedge: { kit: [['cheeseWedge', right]] },
  travelCloak: { kit: [['travelCloak', right]] },
  hourglass: { kit: [['hourglass', right]] },
  scrollRoll: { kit: [['scrollRoll', right]] },
  waxCandle: { kit: [['moonAmulet', right], ['waxCandle', [3, 0]]] },
  moonAmulet: { kit: [['moonAmulet', right]] },
  oilLantern: { kit: [['oilLantern', right]] },
  ironKey: { kit: [['ironKey', left], ['stone', belowLeft]] },
  signetRing: { kit: [['venom', left], ['signetRing', right]] },
  huntingBow: { kit: [['huntingBow', right]] },
  meatJoint: { kit: [['meatJoint', right]] },
  warPick: { kit: [['warPick', right]] },
  woodenClub: { kit: [['woodenClub', right]] },
  sling: { kit: [['sling', right]] },
  leatherCap: { kit: [['leatherCap', right]] },
  chainShirt: { kit: [['chainShirt', right]] },
  ropeCoil: { kit: [['chainShirt', right], ['ropeCoil', [3, 0]]] },
  ironBoots: { kit: [['ironBoots', right]] },
  coinPurse: { kit: [['coinPurse', right]] },
  woodenChest: { kit: [['woodenChest', right]] },
  lockpicks: { kit: [['lockpicks', left]] },
  pickaxe: { kit: [['pickaxe', right]] },
  handShovel: { kit: [['handShovel', right]] },
  sewingKit: { kit: [['sewingKit', right]] },
  quiver: { kit: [['quiver', right]] }
}

/** A fight against a sturdy dummy that guards and hits back; the recruit starts hurt and with Salvage, so every condition can come true. */
function testFight(setup, seed = 1) {
  const items = [{ id: 'dagger', type: 'dagger', owner: 'recruit', position: [1, 0] }, ...setup.kit.map(([type, position]) => ({ id: type, type, owner: 'recruit', position }))]
  const battle = rules.createState({ columns: 5, rows: 3, actors: {
    recruit: { name: 'Tester', team: 'crew', maxHealth: 200, health: 50, resources: { hunger: 0, salvage: 10 }, resourceCaps: { hunger: 99, salvage: 99 }, statuses: setup.recruit?.statuses ?? {} },
    enemy: { name: 'Dummy', team: 'dungeon', maxHealth: 9999, stats: { damage: 5 }, abilities: [
      { id: 'dummyGuard', trigger: { event: 'cycleStart' }, target: { kind: 'self' }, effects: [{ type: 'guard', amount: 1 }] },
      { id: 'dummyAttack', trigger: { event: 'ownTurn' }, target: { kind: 'enemy' }, effects: [{ type: 'damage', amount: { stat: 'damage' } }] }
    ] }
  }, items })
  battle.rolls = { seed, count: 0 }
  let state = battle
  const trace = []
  for (let cycle = 0; cycle < 6; cycle++) {
    const result = rules.resolveCycle(state, { afterCycle: ['enemy'] })
    trace.push(...result.trace)
    state = result.state
  }
  return { state, trace }
}

/** True when the item, or an ability it grants, did something with a nonzero amount. */
const fired = (trace, id) => trace.some(step => step.kind === 'ability' && (step.source?.id === id || step.grantor?.id === id) && step.effects.some(effect => effect.amount > 0))

test('there are eight base items in each power family', () => {
  const counts = {}
  for (const definition of Object.values(familyBaseItems)) counts[familyOf(definition)] = (counts[familyOf(definition)] ?? 0) + 1
  assert.deepEqual(counts, { combat: 8, growth: 8, scholarship: 8, hunger: 8, scavenging: 8 })
})

for (const [id, setup] of Object.entries(setups)) test(`${familyBaseItems[id].name} fires in a fight`, () => {
  assert.ok(fired(testFight(setup).trace, id), `${id} never did anything`)
})

test('Antler Charm gives its touching items potency, and the gift grows every cycle', () => {
  const battle = rules.createState({ columns: 5, rows: 3, actors: { recruit: { team: 'crew', maxHealth: 50 }, enemy: { team: 'dungeon', maxHealth: 999 } },
    items: [{ id: 'mortar', type: 'blightMortar', owner: 'recruit', position: [0, 0] }, { id: 'charm', type: 'antlerCharm', owner: 'recruit', position: [1, 0] }] })
  const before = rules.stat(battle, { kind: 'item', id: 'mortar' }, 'potency')
  const after = rules.stat(rules.resolveCycle(rules.resolveCycle(battle).state).state, { kind: 'item', id: 'mortar' }, 'potency')
  assert.equal(before, 3, 'Blight Mortar 2 + Antler Charm 1')
  assert.ok(after > before, `${before} → ${after}`)
})

test('Travel Satchel gives the items inside it +2 potency', () => {
  const battle = rules.createState({ columns: 4, rows: 3, actors: { recruit: { team: 'crew', maxHealth: 50 }, enemy: { team: 'dungeon', maxHealth: 999 } }, items: [] })
  rules.addItem(battle, 'satchel', 'travelSatchel', 'recruit'); rules.addItem(battle, 'mortar', 'blightMortar', 'recruit')
  assert.ok(rules.place(battle, 'satchel', [4, 0]))
  assert.ok(rules.place(battle, 'mortar', [4, 1]))
  assert.equal(rules.stat(battle, { kind: 'item', id: 'mortar' }, 'potency'), 4, 'Blight Mortar 2 + Satchel 2')
})

test('dice replay the same for one seed and change with the seed', () => {
  const rolls = seed => testFight(setups.coinPurse, seed).trace.filter(step => step.kind === 'ability' && step.source?.id === 'coinPurse').flatMap(step => step.effects.map(effect => effect.amount))
  assert.deepEqual(rolls(7), rolls(7))
  assert.notDeepEqual(rolls(7), rolls(8))
  for (const amount of [...rolls(7), ...rolls(8)]) assert.ok(amount >= 1 && amount <= 6, String(amount))
})

test('Bone Club hurting you does not make Thorn Totem or Sapwood Staff poison or sap your own club', () => {
  const { state } = testFight({ kit: [['woodenClub', right], ['thornTotem', [3, 0]], ['sapwoodStaff', [4, 0]]] })
  for (const item of Object.values(state.items)) assert.deepEqual(Object.keys(item.statuses).filter(id => ['poison', 'sapped'].includes(id)), [], item.type)
  assert.ok(state.actors.enemy.statuses.poison, 'the enemy still gets poisoned when it hits you')
})

test('a die with scaleStat is multiplied by the item stat: a level-1 Grave Shovel (potency 3) digs 3 to 18', () => {
  const { trace } = testFight({ kit: [['handShovel', right]] })
  const digs = trace.filter(step => step.kind === 'ability' && step.source?.id === 'handShovel').flatMap(step => step.effects.map(effect => effect.amount))
  assert.ok(digs.length > 0)
  for (const amount of digs) assert.ok(amount >= 3 && amount <= 18 && amount % 3 === 0, String(amount))
})
