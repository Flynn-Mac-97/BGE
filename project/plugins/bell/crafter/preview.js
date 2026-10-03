/** Concept test fights use a private compiled catalog and never alter the live company or loot. */
import { compileDraft, validateDraft } from './model.js'
export function previewDraft(input) {
  const draft = validateDraft(input), rules = compileDraft(draft)
  const isItem = draft.kind === 'item', isEnemy = draft.kind === 'enemy'
  const subject = { ...(isItem ? { maxHealth: 12, abilities: [] } : draft.definition), name: draft.name, team: 'subject', health: 8, resources: { hunger: 3, salvage: 2 }, resourceCaps: { hunger: 9, salvage: 99 } }
  subject.health = Math.min(subject.maxHealth, subject.health)
  const opponent = { name: isEnemy ? 'Test adventurer' : 'Test foe', team: 'opponent', maxHealth: 18, stats: { damage: 2 }, abilities: [{ id: 'testAttack', trigger: { event: 'ownTurn' }, target: { kind: 'enemy' }, effects: [{ type: 'damage', amount: { stat: 'damage' } }] }] }
  const state = rules.createState({ columns: isItem ? 5 : 3, rows: 3, actors: { subject, opponent }, items: isItem ? [{ id: 'draftItem', type: 'crafted', owner: 'subject' }, { id: 'testBlade', type: 'dagger', owner: 'subject' }] : draft.definition.loadout.map((item, index) => ({ ...item, id: `gear-${index}`, owner: 'subject' })) })
  if (isItem) {
    const storage = rules.catalog.items.crafted.storage
    if (!rules.place(state, 'draftItem', storage ? [5, 0] : [0, 0])) throw new Error('Draft does not fit the 5×3 test grid')
    const desired = storage ? [5, 0] : [draft.definition.footprint[0], 0]
    if (!rules.place(state, 'testBlade', desired)) rules.place(state, 'testBlade', [0, 1])
  }
  const events = [], initial = structuredClone(state)
  const result = rules.resolveFight(state, { maxCycles: 12, ownerOrder: ['subject', 'opponent'], record: (kind, event = {}) => {
    if (kind !== 'ability' || events.length >= 60) return
    const source = event.statusId ?? (event.source?.kind === 'item' ? state.items[event.source.id]?.type : event.source?.id)
    for (const effect of event.effects ?? []) if (effect.amount || effect.blocked) events.push(`${source}: ${effect.type} ${effect.amount ?? ''}${effect.status ? ' ' + effect.status : ''} → ${effect.target.id}${effect.blocked ? ` (${effect.blocked} blocked)` : ''}`)
  } })
  return { initial, winner: rules.winner(result.state) ?? 'stalemate', cycles: result.cycles, subjectHealth: result.state.actors.subject.health, opponentHealth: result.state.actors.opponent.health, events, note: 'Isolated 12-cycle test. Draft acts first, starts at 8 HP with 3 Hunger / 2 Salvage. Foe has 18 HP and attacks for 2. Item drafts get a nearby test dagger. This is feedback, not a balance rating.' }
}
