/** Shared explicit battle fixtures make rule tests independent of dungeon balance. */
import { rules } from '../plugins/bell/rules.js'
export function battleWith(placements = { dagger: [1, 0] }, options = {}) {
  return rules.createState({ columns: options.columns ?? 3, rows: 3,
    actors: { recruit: { team: 'crew', maxHealth: 12, health: options.health ?? 12, resources: { hunger: 0 } },
      enemy: { team: 'dungeon', maxHealth: options.enemyHealth ?? 14, stats: { damage: options.attack ?? 4 }, abilities: [{ id: 'attack', trigger: { event: 'ownTurn' }, target: { kind: 'enemy' }, effects: [{ type: 'damage', amount: { stat: 'damage' } }] }] } },
    items: Object.entries(placements).map(([type, position]) => ({ id: type, type, owner: 'recruit', position })) })
}
export const cycle = battle => rules.resolveCycle(battle, { afterCycle: ['enemy'] })
