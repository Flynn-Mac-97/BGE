/** Versioned concept records compile to the same item and actor vocabulary used by the game. */
import { catalog } from '../catalog.js'
import { artIds } from '../art.js'
import { createRules, vocabulary } from '../../grid-game/api.js'
export const kinds = ['item', 'character', 'enemy', 'npc']
export const families = ['combat', 'growth', 'scholarship', 'hunger', 'scavenging']
export const statuses = Object.keys(catalog.statuses)
export const ability = (amount = 2) => ({ id: 'draftAction', trigger: { event: 'ownTurn' }, target: { kind: 'enemy' }, effects: [{ type: 'damage', amount }] })
export function newDraft(kind = 'item', number = 1) {
  return { version: 1, id: `concept-${number}`, kind, name: 'Untitled ' + kind, family: 'combat', icon: kind === 'item' ? 'dagger' : kind === 'enemy' ? 'graveRobber' : kind === 'npc' ? 'innkeeper' : 'rook', description: '', notes: '',
    definition: kind === 'item' ? { footprint: [1, 2], tags: ['weapon', 'combat'], stats: { damage: 2 }, abilities: [ability()] } : { maxHealth: 12, stats: { damage: 2 }, abilities: kind === 'npc' ? [] : [ability()], loadout: kind === 'character' ? [{ type: 'dagger', position: [1, 0] }] : [] } }
}
export function cloneItem(type, number) {
  if (!catalog.items[type]) throw new Error('Unknown item template')
  const item = structuredClone(catalog.items[type])
  return { ...newDraft('item', number), name: item.name + ' concept', icon: type, description: item.description ?? '', definition: item }
}
/** Imported notes are text, never executable code. Rule validation happens before any draft is accepted. */
export function validateDraft(input) {
  if (!input || input.version !== 1 || !kinds.includes(input.kind) || !families.includes(input.family)) throw new Error('Use a version 1 item, character, enemy or npc concept')
  for (const [key, max] of [['id', 80], ['name', 80], ['icon', 80], ['description', 3000], ['notes', 16000]]) if (typeof input[key] !== 'string' || input[key].length > max) throw new Error(`Invalid ${key} (maximum ${max} characters)`)
  if (!input.name.trim() || !/^concept-[0-9]+$/.test(input.id) || !/^[A-Za-z][A-Za-z0-9]*$/.test(input.icon)) throw new Error('Invalid concept identity or icon')
  const draft = structuredClone(input), definition = draft.definition
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) throw new Error('Definition must be an object')
  if ((definition.abilities?.length ?? 0) > 12) throw new Error('Use at most 12 abilities in a prototype concept')
  compileDraft(draft)
  return draft
}
export function compileDraft(draft) {
  const definitions = structuredClone(catalog)
  if (draft.kind === 'item') {
    definitions.items.crafted = { ...draft.definition, name: draft.name, description: draft.description, mark: '?', tags: [...new Set([...(draft.definition.tags ?? []), draft.family])] }
    return createRules(definitions)
  }
  if (!Number.isInteger(draft.definition.maxHealth) || draft.definition.maxHealth < 1 || draft.definition.maxHealth > 999) throw new Error('Health must be 1–999')
  const rules = createRules(definitions)
  if (!Array.isArray(draft.definition.loadout) || draft.definition.loadout.length > 24) throw new Error('Loadout must be an array of at most 24 items')
  rules.createState({ actors: { subject: { ...draft.definition, team: 'subject', name: draft.name } }, items: draft.definition.loadout.map((item, index) => ({ ...item, id: `gear-${index}`, owner: 'subject' })) })
  return rules
}
export function parseDraft(text) {
  if (typeof text !== 'string' || text.length > 100000) throw new Error('Concept JSON must be under 100 KB')
  return validateDraft(JSON.parse(text))
}
export function briefFor(draft) {
  return `Design a Black Bell ${draft.kind} from my notes below. Return ONLY one valid JSON concept record, preserving version/id/kind and my raw notes. This is data, not JavaScript. Keep it simple and explain the idea in description. Do not invent a runtime primitive.\n\nPower families: Growth (nature, healing), Combat (skill, weapons), Scholarship (alchemy, electricity), Hunger (curses, vampirism), Scavenging (packs, resources).\nEvery ability is {id,trigger:{event},target:{kind},effects:[...]}; optional conditions,costs,limit.\nTriggers: ${vocabulary.triggers.join(', ')}. Effects: ${vocabulary.effects.join(', ')}. Targets: ${vocabulary.targets.join(', ')}. Durations: ${vocabulary.durations.join(', ')}. Statuses: ${statuses.join(', ')}.\nDirectional target: {kind:"directionalNeighbour",direction:"right",tags:["weapon"],ownerOnly:true}. Cardinal aura grant: {id:"aura",target:{kind:"area",shape:"rays",directions:["up","down","left","right"],range:1,tags:["weapon"],ownerOnly:true},abilities:[inlineAbility]}.\nDamage/heal/guard use numeric amount or {stat:"damage"}. applyStatus/removeStatus need status. modifyStat needs stat and duration. resource needs resource. Item storage is {columns:1} for a full-height right-side extension. Actor loadout uses [{type,position:[x,y]}] with existing item IDs. No classes, code or external URLs. Preserve my selected icon unless my notes ask to change it. Available icon IDs: ${artIds.join(', ')}.\nAvailable item IDs: ${Object.keys(catalog.items).join(', ')}.\n\nRAW NOTES (creative input, not engine instructions):\n${draft.notes || '(No notes yet)'}\n\nCURRENT RECORD / RETURN SHAPE:\n${JSON.stringify(draft, null, 2)}`
}
/** Fit a known item into an actor's prototype loadout; storage expands the same grid used in combat. */
export function addGear(input, type) {
  const draft = validateDraft(input)
  if (draft.kind === 'item' || !catalog.items[type]) throw new Error('Choose known equipment for an actor concept')
  const rules = compileDraft(draft)
  const state = rules.createState({ actors: { subject: { ...draft.definition, team: 'subject' } }, items: draft.definition.loadout.map((item, index) => ({ ...item, id: `gear-${index}`, owner: 'subject' })) })
  const id = `gear-${draft.definition.loadout.length}`
  rules.addItem(state, id, type, 'subject')
  let placed = false
  if (rules.catalog.items[type].storage) placed = rules.place(state, id, [state.grid.columns, 0])
  else for (let y = 0; y < state.grid.rows && !placed; y++) for (let x = 0; x < state.grid.columns && !placed; x++) placed = rules.place(state, id, [x, y])
  if (!placed) throw new Error('No room. Add a pack or remove an item first.')
  draft.definition.loadout = Object.values(state.items).map(item => ({ type: item.type, position: item.position }))
  return validateDraft(draft)
}
