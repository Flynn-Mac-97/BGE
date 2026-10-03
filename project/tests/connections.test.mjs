/** Preview geometry and normal turn order agree with combat without mutating its state. */
import assert from 'node:assert/strict'
import { defineSuite } from '../tools/node-suite.mjs'
import { activationOrder, connectionPreview } from '../plugins/bell/connections.js'
import { battleWith } from '../tools/rule-fixtures.mjs'
import { rules } from '../plugins/bell/rules.js'
import { fixture } from '../tools/ui-fixture.mjs'
const { test, suite } = defineSuite('Planning connections and timing')
export default suite

test('early preparation highlights the weapon and late preparation warns through its lower footprint cell', () => {
  const battle = battleWith({ venom: [0, 0], dagger: [1, 0] })
  const early = connectionPreview(battle, 'venom')
  assert.deepEqual(early.order, { venom: 1, dagger: 2 })
  assert.deepEqual(early.warnings, [])
  assert.equal(early.links[0].kind, 'target')
  assert.match(early.links[0].text, /before its normal turn/)
  rules.place(battle, 'venom', [0, 1])
  const late = connectionPreview(battle, 'venom')
  assert.equal(late.links[0].kind, 'late')
  assert.match(late.warnings[0], /Too late: Rusty Dagger acts first/)
  assert.match(late.links[0].text, /extra action/)
  assert.match(connectionPreview(battle, 'dagger').warnings[0], /Late preparation from Venom Vial/)
})
test('wrong-facing, off-grid and ineligible targets explain the missing weapon', () => {
  for (const placements of [{ dagger: [0, 0], venom: [1, 0] }, { dagger: [0, 0], venom: [2, 0] }, { venom: [0, 0], salve: [1, 0], dagger: [2, 0] }]) {
    const preview = connectionPreview(battleWith(placements), 'venom')
    assert.equal(preview.links.length, 0)
    assert.deepEqual(preview.warnings, ['No weapon to the right.'])
  }
})
test('passive reactions point from watched weapon to listener, with no late warning', () => {
  const battle = battleWith({ dagger: [0, 0], tooth: [0, 2], banner: [1, 0] })
  assert.deepEqual(activationOrder(battle), { dagger: 1 })
  const reaction = connectionPreview(battle, 'tooth')
  assert.deepEqual(reaction.links.map(link => [link.source, link.target, link.kind]), [['dagger', 'tooth', 'reaction']])
  assert.deepEqual(reaction.warnings, [])
  assert.match(reaction.links[0].text, /event must happen/)
  assert.equal(connectionPreview(battle, 'banner').links[0].kind, 'aura')
})
test('extra-action links are not mislabelled as temporary preparation', () => {
  const preview = connectionPreview(battleWith({ echo: [1, 0], dagger: [1, 1] }), 'echo')
  assert.equal(preview.links[0].kind, 'target')
  assert.match(preview.links[0].text, /extra action/)
  assert.deepEqual(preview.warnings, [])
})
test('copies and expanded columns keep correct turn order; previews never mutate combat', () => {
  const battle = battleWith({ dagger: [1, 0], venom: [0, 0] }, { columns: 5 })
  rules.addItem(battle, 'other-vial', 'venom', 'recruit'); rules.place(battle, 'other-vial', [0, 1])
  const original = structuredClone(battle)
  assert.deepEqual(connectionPreview(battle, 'dagger').links.map(link => link.kind), ['target', 'late'])
  assert.deepEqual(activationOrder(battle), { venom: 1, dagger: 2, 'other-vial': 3 })
  assert.deepEqual(battle, original)
  rules.place(battle, 'venom', null)
  assert.equal(connectionPreview(battle, 'venom').links.length, 0)
})
test('selecting highlights connections immediately, moving updates warnings, and combat hides planning markers', () => {
  const game = fixture()
  for (let room = 1; room <= 4; room++) { game.panel.on.fight(); game.tick(200); if (room < 4) game.panel.on.descend() } game.panel.on.claim('venom')
  game.panel.on.select('item-2'); game.panel.on.cell(0); game.panel.on.cell(0)
  assert.equal((game.panel.html().match(/equipment-shape preview-linked/g) ?? []).length, 2)
  assert.match(game.panel.html(), /Preview: Venom Vial → Rusty Dagger/)
  assert.match(game.panel.html(), /Normal turn 1/)
  game.panel.on.move(); game.panel.on.cell(3); game.panel.on.cell(3)
  assert.match(game.panel.html(), /Too late: Rusty Dagger acts first/)
  assert.match(game.panel.html(), /preview-late/)
  game.panel.on.details()
  assert.match(game.panel.html(), /Preparation expires unless an extra action/)
  game.panel.on.deselect(); game.panel.on.fight()
  assert.doesNotMatch(game.panel.html(), /scan-marker|preview-linked|preview-late/)
})
