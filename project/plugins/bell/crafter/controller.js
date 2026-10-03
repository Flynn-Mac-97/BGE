/** UI actions edit plain concept records; only Save writes the device library. */
import { newDraft, cloneItem, addGear, validateDraft, parseDraft, briefFor } from './model.js'
import { draftStore } from './store.js'
import { previewDraft } from './preview.js'
import { crafterView } from './view.js'
import { artIds, artCategories } from '../art.js'
export function createCrafter(kit, storage, redraw, close) {
  const store = draftStore(storage), library = store.load()
  const state = { library, draft: library.drafts[0] ? structuredClone(library.drafts[0]) : newDraft('item', library.next++), tab: 'concept', message: '', warning: store.warning(), transfer: '', test: null, dirty: false, gallery: { kind: 'all', category: 'all', query: '' },
    rule: { trigger: 'ownTurn', target: 'enemy', effect: 'damage', amount: 2, status: 'poison', stat: 'damage', resource: 'hunger', duration: 'instant', limit: 1 } }
  const refresh = () => { state.warning = store.warning(); redraw() }
  const changed = () => { state.dirty = true; state.test = null; state.message = 'Edited. Save concept to keep these changes.'; refresh() }
  const attempt = fn => { try { fn() } catch (error) { state.message = error.message } refresh() }
  const keepCurrent = () => {
    if (!state.dirty) return
    const draft = validateDraft(state.draft), index = library.drafts.findIndex(item => item.id === draft.id)
    if (index < 0 && library.drafts.length >= 50) throw new Error('Save or export before creating another concept; the library holds 50.')
    if (index >= 0) library.drafts[index] = draft; else library.drafts.push(draft)
    store.save(library); state.dirty = false
  }
  const actions = {
    craftClose: close,
    craftTab(value) { if (['concept', 'art', 'rules', 'test', 'exchange'].includes(value)) state.tab = value; refresh() },
    craftChooseArt() { state.gallery = { kind: state.draft.kind === 'item' ? 'item' : 'portrait', category: 'all', query: '' }; state.tab = 'art'; refresh() },
    craftArtKind(value) { if (['all', 'item', 'portrait'].includes(value)) { state.gallery.kind = value; state.gallery.category = 'all' } refresh() },
    craftArtCategory(value) { if (value === 'all' || artCategories(state.gallery.kind).includes(value)) state.gallery.category = value; refresh() },
    craftArtQuery(value) { state.gallery.query = String(value).slice(0, 80); refresh() },
    craftNew(kind) { attempt(() => { keepCurrent(); state.draft = newDraft(kind, library.next++); state.tab = 'concept'; state.dirty = true; state.test = null; state.transfer = ''; state.message = 'New concept. Save it to add it to your library.'; refresh() }) },
    craftLoad(id) { attempt(() => { keepCurrent(); const saved = library.drafts.find(draft => draft.id === id); if (saved) { state.draft = structuredClone(saved); state.tab = 'concept'; state.dirty = false; state.test = null; state.transfer = ''; state.message = 'Saved concept loaded.'; refresh() } }) },
    craftTemplate(type) { attempt(() => { keepCurrent(); state.draft = cloneItem(type, library.next++); state.tab = 'concept'; changed() }) },
    craftSave() { attempt(() => { const draft = validateDraft(state.draft), index = library.drafts.findIndex(item => item.id === draft.id); if (index < 0 && library.drafts.length >= 50) throw new Error('Library holds 50 concepts. Export a backup before replacing one.'); if (index >= 0) library.drafts[index] = draft; else library.drafts.push(draft); const saved = store.save(library); state.dirty = !saved; state.message = saved ? 'Concept saved on this device.' : 'Concept is in this session only; export a backup.' }) },
    craftName(value) { state.draft.name = String(value).slice(0, 80); changed() },
    craftFamily(value) { state.draft.family = value; changed() },
    craftIcon(value) { if (!artIds.includes(value)) return; state.draft.icon = value; changed() },
    craftDescription(value) { state.draft.description = String(value).slice(0, 3000); changed() },
    craftNotes(value) { state.draft.notes = String(value).slice(0, 16000); changed() },
    craftWidth(value) { state.draft.definition.footprint[0] = Number(value); changed() },
    craftHeight(value) { state.draft.definition.footprint[1] = Number(value); changed() },
    craftHealth(value) { state.draft.definition.maxHealth = Number(value); changed() },
    craftRuleTrigger(value) { state.rule.trigger = value; refresh() }, craftRuleTarget(value) { state.rule.target = value; refresh() },
    craftRuleEffect(value) { state.rule.effect = value; refresh() }, craftRuleAmount(value) { state.rule.amount = Number(value); refresh() },
    craftRuleStatus(value) { state.rule.status = value; refresh() }, craftRuleStat(value) { state.rule.stat = String(value).slice(0, 50); refresh() },
    craftRuleResource(value) { state.rule.resource = String(value).slice(0, 50); refresh() }, craftRuleDuration(value) { state.rule.duration = value; refresh() },
    craftRuleLimit(value) { state.rule.limit = Number(value); refresh() },
    craftGear(type) { attempt(() => { state.draft = addGear(state.draft, type); changed() }) },
    craftRemoveGear(value) { attempt(() => { const candidate = structuredClone(state.draft); candidate.definition.loadout.splice(Number(value), 1); state.draft = validateDraft(candidate); changed() }) },
    craftAddRule() { attempt(() => {
      const rule = state.rule, definition = state.draft.definition
      const target = ['right', 'left', 'up', 'down'].includes(rule.target) ? { kind: 'directionalNeighbour', direction: rule.target, tags: ['weapon'], ownerOnly: true } : { kind: rule.target, ...(rule.target === 'adjacentItems' ? { tags: ['weapon'], ownerOnly: true } : {}) }
      const effect = { type: rule.effect, ...(rule.effect === 'triggerItem' ? {} : { amount: rule.amount }), ...(['applyStatus', 'removeStatus'].includes(rule.effect) ? { status: rule.status } : {}), ...(rule.effect === 'modifyStat' ? { stat: rule.stat, duration: rule.duration } : {}), ...(rule.effect === 'resource' ? { resource: rule.resource } : {}) }
      if (rule.effect === 'applyStatus' && rule.duration !== 'instant') effect.duration = rule.duration
      const abilities = definition.abilities ?? []
      const id = 'draftRule-' + (1 + Math.max(0, ...abilities.map(ability => Number(String(ability.id ?? '').split('-').at(-1)) || 0)))
      const candidate = structuredClone(state.draft)
      candidate.definition.abilities = [...abilities, { id, trigger: { event: rule.trigger }, target, effects: [effect], ...(rule.limit ? { limit: { perCycle: rule.limit } } : {}) }]
      state.draft = validateDraft(candidate); changed()
    }) },
    craftRemoveRule(value) { const index = Number(value); state.draft.definition.abilities = state.draft.definition.abilities.filter((_, position) => position !== index); changed() },
    craftTest() { attempt(() => { state.test = previewDraft(state.draft); state.tab = 'test'; state.message = 'Test complete. Campaign progress was not changed.' }) },
    craftExport() { attempt(() => { state.transfer = JSON.stringify(validateDraft(state.draft), null, 2); state.tab = 'exchange'; state.message = 'Copy this JSON to back up or share the concept.' }) },
    craftBrief() { state.transfer = briefFor(state.draft); state.tab = 'exchange'; state.message = 'Copy this brief into ChatGPT. Paste its JSON reply here, then choose Import JSON.'; refresh() },
    craftTransfer(value) { state.transfer = String(value).slice(0, 100000); refresh() },
    craftImport() { attempt(() => { const imported = parseDraft(state.transfer); keepCurrent(); imported.id = `concept-${library.next++}`; state.draft = imported; state.test = null; state.dirty = true; state.tab = 'concept'; state.message = 'JSON validated and imported as a new concept. Save it to keep it.' }) },
    craftCopy() { state.message = 'Select the text below and copy it.'; refresh(); if (globalThis.navigator?.clipboard?.writeText) navigator.clipboard.writeText(state.transfer).then(() => { state.message = 'Copied.'; refresh() }).catch(() => { state.message = 'Clipboard unavailable here. Long-press the text below, select all, and copy.'; refresh() }) }
  }
  return { actions, read: () => structuredClone(state), view: () => crafterView(kit, state) }
}
