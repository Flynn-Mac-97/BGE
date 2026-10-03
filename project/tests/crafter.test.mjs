/** Concepts remain portable data; importing or testing one cannot change campaign progress. */
import assert from 'node:assert/strict'
import { defineSuite } from '../tools/node-suite.mjs'
import { newDraft, cloneItem, validateDraft, parseDraft, briefFor } from '../plugins/bell/crafter/model.js'
import { previewDraft } from '../plugins/bell/crafter/preview.js'
import { draftStore, draftKey } from '../plugins/bell/crafter/store.js'
import { fixture } from '../tools/ui-fixture.mjs'
import { artLibrary, artChoices } from '../plugins/bell/art.js'
const { test, suite } = defineSuite('Scribe concept bench')
export default suite
const memory = () => { const entries = new Map(); return { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) } }

test('all four concept kinds validate, preserve notes and run bounded private tests', () => {
  for (const kind of ['item', 'character', 'enemy', 'npc']) {
    const draft = newDraft(kind, 1); draft.notes = 'A beggar who trades curses for soup.\nNo armour.'
    assert.deepEqual(parseDraft(JSON.stringify(draft)), draft)
    assert.match(briefFor(draft), /A beggar who trades curses for soup/)
    const result = previewDraft(draft)
    assert.ok(result.cycles > 0 && result.cycles <= 12)
    assert.equal(draft.definition.maxHealth ?? 12, 12)
  }
})
test('existing aura and storage templates run through real grants and costs', () => {
  const shock = previewDraft(cloneItem('stormTotem', 1))
  assert.ok(shock.events.some(event => event.includes('shock')))
  const pack = previewDraft(cloneItem('salvagePack', 2))
  assert.ok(pack.events.some(event => event.includes('resource')))
})
test('malformed rules and executable text are refused without accepting a partial concept', () => {
  assert.throws(() => parseDraft('alert(1)'), /JSON|Unexpected/)
  const draft = newDraft(); draft.definition.abilities[0].effects[0].type = 'invented'
  assert.throws(() => validateDraft(draft), /unknown effect/)
  const actor = newDraft('enemy'); actor.definition.loadout = [{ type: 'missing', position: [0, 0] }]
  assert.throws(() => validateDraft(actor))
})
test('library saves reload and corrupt data stays untouched', () => {
  const storage = memory(), library = { version: 1, next: 2, drafts: [newDraft()] }
  const store = draftStore(storage); assert.ok(store.save(library)); assert.deepEqual(store.load(), library)
  storage.setItem(draftKey, '{broken'); const broken = draftStore(storage); broken.load(); assert.equal(broken.save(library), false)
  assert.equal(storage.getItem(draftKey), '{broken'); assert.match(broken.warning(), /preserved/)
})
test('mobile actions save raw notes, import an AI record and test without changing the company', () => {
  const storage = memory(), game = fixture({ storage }), before = game.read().company
  game.panel.on.openCrafter(); assert.equal(game.read().screen, 'crafter')
  game.panel.on.craftName('Mossy tooth'); game.panel.on.craftNotes('Heal the wielder when a neighbour attacks.\nSlow and organic.')
  game.panel.on.craftSave(); game.panel.on.craftBrief()
  assert.match(game.context.bellCrafter.read().transfer, /Slow and organic/)
  const imported = newDraft('enemy', 4); imported.name = 'Soup Ghoul'
  game.panel.on.craftTransfer(JSON.stringify(imported)); game.panel.on.craftImport(); game.panel.on.craftSave(); game.panel.on.craftTest()
  assert.ok(game.context.bellCrafter.read().test.cycles)
  assert.deepEqual(game.read().company, before)
  game.panel.on.craftClose(); assert.equal(game.read().screen, 'expedition')
  const reopened = fixture({ tavern: true, storage }); assert.equal(reopened.context.bellCrafter.read().library.drafts.length, 2)
})
test('rule composer adds real modular effects and an invalid import preserves the edited draft', () => {
  const game = fixture({ tavern: true, storage: memory() }); game.panel.on.openCrafter()
  game.panel.on.craftRuleTrigger('cycleStart'); game.panel.on.craftRuleTarget('owner'); game.panel.on.craftRuleEffect('heal'); game.panel.on.craftAddRule()
  assert.equal(game.context.bellCrafter.read().draft.definition.abilities.length, 2)
  const before = game.context.bellCrafter.read().draft
  game.panel.on.craftTransfer('{no'); game.panel.on.craftImport(); assert.deepEqual(game.context.bellCrafter.read().draft, before)
  game.panel.on.craftTest(); assert.ok(game.context.bellCrafter.read().test.events.some(event => event.includes('heal')))
})
test('actor loadouts accept storage and equipment through the same placement rules', () => {
  const game = fixture({ tavern: true, storage: memory() }); game.panel.on.openCrafter(); game.panel.on.craftNew('enemy')
  game.panel.on.craftGear('salvagePack'); game.panel.on.craftGear('dagger')
  assert.equal(game.context.bellCrafter.read().draft.definition.loadout.length, 2)
  game.panel.on.craftTest(); assert.ok(game.context.bellCrafter.read().test)
})
test('visual art choices filter without editing rules and survive save, reload and JSON exchange', () => {
  assert.equal(new Set(artLibrary.map(entry => entry.id)).size, artLibrary.length)
  assert.equal(artLibrary.filter(entry => entry.category !== 'Original set').length, 128)
  assert.equal(artChoices({ kind: 'portrait', category: 'Creatures' }).length, 16)
  assert.deepEqual(artChoices({ kind: 'item', query: '  MOON  ' }).map(entry => entry.id), ['moonAmulet'])
  const storage = memory(), game = fixture({ tavern: true, storage })
  game.panel.on.openCrafter(); game.panel.on.craftNotes('Keep this idea and its rules.')
  const before = game.context.bellCrafter.read().draft
  game.panel.on.craftChooseArt(); game.panel.on.craftArtKind('item'); game.panel.on.craftArtCategory('Relics'); game.panel.on.craftArtQuery('moon')
  assert.equal(game.context.bellCrafter.read().tab, 'art')
  game.panel.on.craftIcon('moonAmulet'); game.panel.on.craftIcon('../../missing'); game.panel.on.craftSave()
  assert.equal(game.context.bellCrafter.read().draft.icon, 'moonAmulet')
  assert.deepEqual(game.context.bellCrafter.read().draft.definition, before.definition)
  assert.equal(game.context.bellCrafter.read().draft.notes, before.notes)
  game.panel.on.craftArtKind('portrait'); assert.equal(game.context.bellCrafter.read().gallery.category, 'all')
  game.panel.on.craftNew('npc'); game.panel.on.craftChooseArt(); assert.equal(game.context.bellCrafter.read().gallery.kind, 'portrait')
  game.panel.on.craftIcon('packYak'); game.panel.on.craftSave(); game.panel.on.craftExport()
  assert.equal(parseDraft(game.context.bellCrafter.read().transfer).icon, 'packYak')
  const reopened = fixture({ tavern: true, storage })
  assert.deepEqual(reopened.context.bellCrafter.read().library.drafts.map(draft => draft.icon), ['moonAmulet', 'packYak'])
})
