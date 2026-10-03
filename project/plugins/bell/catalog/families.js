/** Family test pieces compose shared primitives; their provisional numbers are not a balance pass. */
export const familyAbilities = {
  rootMend: { trigger: { event: 'damageDealt' }, target: { kind: 'owner' }, effects: [{ type: 'heal', amount: 2 }], limit: { perCycle: 1 } },
  breakArmour: { trigger: { event: 'ownTurn' }, target: { kind: 'enemy' }, effects: [{ type: 'removeGuard', amount: 1 }, { type: 'damage', amount: { stat: 'damage' } }] },
  shockHit: { trigger: { event: 'damageDealt' }, target: { kind: 'eventTarget' }, effects: [{ type: 'applyStatus', status: 'shock', amount: 2 }], limit: { perCycle: 1 } },
  shockTick: { trigger: { event: 'cycleEnd' }, target: { kind: 'self' }, effects: [{ type: 'consumeStatus', status: 'shock', amount: 8 }, { type: 'damage', amount: { previous: true }, bypassGuard: true }] },
  deepenCurse: { trigger: { event: 'cycleEnd' }, target: { kind: 'enemy' }, effects: [{ type: 'applyStatus', status: 'curse', amount: 1 }] },
  reapCurse: { trigger: { event: 'cycleEnd' }, target: { kind: 'enemy' }, conditions: [{ kind: 'hasStatus', status: 'curse', amount: 2 }], effects: [{ type: 'consumeStatus', status: 'curse', amount: 2 }, { type: 'damage', amount: { previous: true, scale: 3 }, bypassGuard: true }] },
  collectSalvage: { trigger: { event: 'itemActivated' }, target: { kind: 'owner' }, effects: [{ type: 'resource', resource: 'salvage', amount: 2 }], limit: { perCycle: 1 } },
  patchGuard: { trigger: { event: 'ownTurn' }, target: { kind: 'owner' }, costs: [{ target: { kind: 'owner' }, resource: 'salvage', amount: 2 }], effects: [{ type: 'guard', amount: 4 }] }
}
const edges = { kind: 'area', shape: 'rays', directions: ['up', 'down', 'left', 'right'], range: 1, tags: ['weapon'], ownerOnly: true }
export const familyItems = {
  rootTotem: { name: 'Root Totem', mark: 'R', footprint: [1, 1], tags: ['growth', 'relic'], grants: [{ id: 'mendingRoots', target: edges, abilities: ['rootMend'] }], description: 'Touching weapons heal their owner for 2 when they deal damage. Once per weapon per cycle. No diagonal links.' },
  hammer: { name: 'Notched Hammer', mark: 'M', footprint: [1, 2], tags: ['weapon', 'combat'], stats: { damage: 3 }, abilities: ['breakArmour'], description: 'Strip 1 guard, then deal 3 damage. Whetstones and banners increase its damage.' },
  stormTotem: { name: 'Storm Totem', mark: 'E', footprint: [1, 1], tags: ['scholarship', 'relic'], grants: [{ id: 'electricAura', target: edges, abilities: ['shockHit'] }], description: 'Touching weapons apply 2 Shock on a damaging hit, once per weapon per cycle. Shock discharges at cycle end, bypassing guard.' },
  curseIdol: { name: 'Curse Idol', mark: 'C', footprint: [1, 1], tags: ['hunger', 'relic'], abilities: ['deepenCurse'], description: 'At cycle end, add 1 Curse to the enemy. Place before the Reaping Seal in scan order.' },
  reapingSeal: { name: 'Reaping Seal', mark: 'X', footprint: [1, 1], tags: ['hunger', 'relic'], abilities: ['reapCurse'], description: 'At cycle end, consume 2 Curse to deal 6 damage through guard. Waits until 2 stacks exist.' },
  salvagePack: { name: 'Salvager Pack', mark: 'P', footprint: [1, 1], storage: { columns: 1 }, tags: ['storage', 'scavenging'], grants: [{ id: 'recoverScraps', target: { kind: 'containerItems', tags: ['weapon'], ownerOnly: true }, abilities: ['collectSalvage'] }], description: 'Attach at the right edge. Each weapon wholly inside generates 2 Salvage after activation, once per cycle. Salvage is a combat resource, separate from room scrap.' },
  patchKit: { name: 'Patch Kit', mark: 'K', footprint: [1, 1], tags: ['scavenging', 'tool'], abilities: ['patchGuard'], description: 'Spend 2 combat Salvage to gain 4 guard. Weapons inside the Salvager Pack supply it.' }
}
