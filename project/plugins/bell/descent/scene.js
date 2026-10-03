/** What the side-on scene shows, read from the game state: the hero's gear, who attacks now, and whether a floor has begun. */
import { placedItems } from '../../grid-game/grid.js'
import { gearModels, backSlots } from './gear-models.js'

/** The attacker of a resolved step that hurt someone: 'recruit', 'enemy', or null. */
function attackerOf(step, battle) {
  if (step?.kind !== 'ability' || step.statusId || !step.effects.some(effect => effect.type === 'damage' && effect.amount > 0)) return null
  if (step.source.kind === 'actor') return step.source.id
  return battle.items[step.source.id]?.owner ?? null
}

/** `{ isShown, floor, phase, attacker, serial, held, offHand, back: [{ model, scale, position, rotation }], foeKind }`. */
export function sceneFacts(state) {
  const journey = state.journey
  if (state.screen !== 'expedition' || !journey?.descent) return { isShown: false }
  const gear = placedItems(journey.battle).map(item => gearModels[item.type]).filter(Boolean)
  const held = gear.find(entry => entry.hold) ?? null
  const offHand = held?.hold === 'sword' ? gear.find(entry => entry.offHand) ?? null : null
  const back = gear.filter(entry => entry !== held && entry !== offHand).slice(0, backSlots.length)
    .map((entry, index) => ({ model: `models/items/${entry.back}.glb`, scale: entry.scale, ...backSlots[index] }))
  return { isShown: true, floor: journey.descent.floor, phase: journey.phase, attacker: attackerOf(state.step, journey.battle), serial: state.serial,
    held: held?.hold ?? null, offHand: offHand?.offHand ?? null, back, foeKind: journey.descent.enemy.kind }
}
