/** Shared ability blocks contain rules only; item art and family never choose behaviour. */
export const abilities = {
  strike: { trigger: { event: 'ownTurn' }, target: { kind: 'enemy' }, effects: [
    { type: 'damage', amount: { stat: 'damage' } },
    { type: 'applyStatus', status: 'poison', amount: { stat: 'poisonOnHit' } }
  ] },
  coat: { trigger: { event: 'ownTurn' }, target: { kind: 'directionalNeighbour', direction: 'right', tags: ['weapon'], ownerOnly: true },
    effects: [{ type: 'applyStatus', status: 'coating', amount: 2 }], limit: { perCycle: 1 } },
  sharpen: { trigger: { event: 'ownTurn' }, target: { kind: 'directionalNeighbour', direction: 'right', tags: ['weapon'], ownerOnly: true },
    effects: [{ type: 'modifyStat', stat: 'damage', amount: 2, duration: 'nextAction', expires: 'cycle' }], limit: { perCycle: 1 } },
  protect: { trigger: { event: 'ownTurn' }, target: { kind: 'owner' }, effects: [{ type: 'guard', amount: { stat: 'guard' } }] },
  mend: { trigger: { event: 'ownTurn' }, target: { kind: 'owner' }, effects: [{ type: 'heal', amount: { stat: 'heal' } }], limit: { charges: 1, refill: 'cycle' } },
  venomGuard: { trigger: { event: 'statusApplied', status: 'poison', source: { kind: 'adjacentItems', tags: ['weapon'], ownerOnly: true } },
    target: { kind: 'owner' }, effects: [{ type: 'guard', amount: 2 }], limit: { perCycle: 1 } },
  feed: { trigger: { event: 'damageDealt', source: { kind: 'adjacentItems', tags: ['weapon'], ownerOnly: true } },
    target: { kind: 'owner' }, effects: [{ type: 'resource', resource: 'hunger', amount: 1 }], limit: { perCycle: 1 } },
  drink: { trigger: { event: 'ownTurn' }, target: { kind: 'owner' },
    conditions: [{ kind: 'healthBelow', ratio: 1 }], costs: [{ target: { kind: 'owner' }, resource: 'hunger', amount: 3 }], effects: [{ type: 'heal', amount: 6 }] },
  cleanse: { trigger: { event: 'ownTurn' }, target: { kind: 'owner' }, effects: [{ type: 'removeStatus', status: 'poison', amount: 3 }] },
  echo: { trigger: { event: 'ownTurn' }, target: { kind: 'directionalNeighbour', direction: 'down', tags: ['weapon'], ownerOnly: true },
    effects: [{ type: 'triggerItem' }], limit: { perCombat: 1 } },
  regrow: { trigger: { event: 'ownTurn' }, target: { kind: 'owner' }, effects: [{ type: 'applyStatus', status: 'regeneration', amount: 2 }], limit: { perCombat: 1 } },
  poisonTick: { trigger: { event: 'cycleEnd' }, target: { kind: 'self' }, effects: [
    { type: 'damage', amount: { stacks: true }, bypassGuard: true }, { type: 'removeStatus', status: 'poison', amount: 1 }
  ] },
  regenerationTick: { trigger: { event: 'cycleStart' }, target: { kind: 'self' }, effects: [
    { type: 'heal', amount: { stacks: true } }, { type: 'removeStatus', status: 'regeneration', amount: 1 }
  ] }
}
