/** Storage capacity follows supported item placement, including after serialization and combat. */
import { defineSuite } from '../tools/node-suite.mjs'
import assert from 'node:assert/strict'
import { rules } from '../plugins/bell/rules.js'
import { createRules } from '../plugins/grid-game/api.js'
import { createJourney } from '../plugins/bell/loop.js'
const { test, suite } = defineSuite('Storage items')
export default suite

test('reserve storage grants nothing; equipping adds full-height columns without moving gear', () => {
  const battle = createJourney().battle
  rules.addItem(battle, 'bag', 'pouch', 'recruit')
  assert.equal(battle.grid.columns, 3)
  assert.equal(rules.place(battle, 'bag', [3, 0]), true)
  assert.deepEqual(battle.grid, { columns: 4, rows: 3 })
  assert.deepEqual(battle.items['item-1'].position, [1, 0])
  assert.equal(rules.place(battle, 'bag', [0, 2]), false)
  assert.equal(battle.grid.columns, 4)
  assert.equal(rules.place(battle, 'bag', null), true)
  assert.equal(battle.grid.columns, 3)
})
test('packs chain through supported columns; self-support and occupied shrinkage fail atomically', () => {
  const battle = createJourney().battle
  rules.addItem(battle, 'bag', 'pouch', 'recruit')
  rules.addItem(battle, 'pack', 'pack', 'recruit')
  rules.place(battle, 'bag', [3, 0])
  assert.equal(rules.place(battle, 'pack', [4, 0]), true)
  assert.equal(battle.grid.columns, 6)
  rules.place(battle, 'item-1', [5, 0])
  const before = structuredClone(battle)
  assert.equal(rules.place(battle, 'bag', null), false)
  assert.equal(rules.place(battle, 'pack', null), false)
  assert.equal(rules.place(battle, 'bag', [4, 0]), false)
  assert.deepEqual(battle, before)
  const resolved = rules.resolveCycle(JSON.parse(JSON.stringify(battle)), { afterCycle: ['enemy'] })
  assert.equal(resolved.state.grid.columns, 6)
  assert.deepEqual(battle, before)
  rules.place(battle, 'item-1', [1, 0])
  assert.equal(rules.place(battle, 'pack', null), true)
  assert.equal(rules.place(battle, 'bag', null), true)
  assert.equal(battle.grid.columns, 3)
})
test('catalog storage is generic, validated and limited to twelve total columns', () => {
  for (const columns of [0, -1, 1.5, 10, '1']) assert.throws(() => createRules({ items: { bag: { name: 'Bag', footprint: [1, 1], storage: { columns } } } }), /storage/)
  const custom = createRules({ items: { chest: { name: 'Chest', footprint: [1, 1], storage: { columns: 9 } } } })
  const battle = custom.createState({ actors: { hero: { maxHealth: 1, team: 'crew' } }, items: [{ id: 'one', type: 'chest', owner: 'hero' }, { id: 'two', type: 'chest', owner: 'hero' }] })
  assert.equal(custom.place(battle, 'one', [3, 0]), true)
  assert.equal(battle.grid.columns, 12)
  const before = structuredClone(battle)
  assert.equal(custom.place(battle, 'two', [12, 0]), false)
  assert.deepEqual(battle, before)
})

test('container cells are usable and directional effects cross the attachment seam', () => {
  const battle = createJourney().battle
  rules.addItem(battle, 'bag', 'pouch', 'recruit')
  rules.place(battle, 'bag', [3, 0])
  assert.deepEqual(rules.cells(battle, 'bag'), [])
  assert.equal(rules.place(battle, 'item-1', [3, 0]), true)
  rules.addItem(battle, 'vial', 'venom', 'recruit')
  rules.place(battle, 'vial', [2, 0])
  assert.equal(rules.adjacent(battle, 'vial', 'item-1'), true)
  const result = rules.resolveCycle(battle)
  assert.ok(result.state.actors.enemy.statuses.poison || result.state.actors.enemy.health === 0)
})
