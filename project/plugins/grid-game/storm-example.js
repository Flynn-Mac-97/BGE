/** Authoring example only; it does not alter the live loot pool or encounter balance. */
export const stormExample = {
  abilities: {
    strike: { trigger: { event: 'ownTurn' }, target: { kind: 'enemy' }, effects: [{ type: 'damage', amount: { stat: 'damage' } }] },
    shockHit: { trigger: { event: 'damageDealt' }, target: { kind: 'eventTarget' }, effects: [{ type: 'applyStatus', status: 'shock', amount: 1 }], limit: { perCycle: 1 } }
  },
  statuses: {
    shock: { maxStacks: 8, abilities: [{ id: 'discharge', trigger: { event: 'cycleEnd' }, target: { kind: 'self' }, effects: [
      { type: 'consumeStatus', status: 'shock', amount: 8 },
      { type: 'damage', amount: { previous: true }, bypassGuard: true }
    ] }] }
  },
  items: {
    blade: { name: 'Test Blade', footprint: [1, 1], tags: ['weapon'], stats: { damage: 2 }, abilities: ['strike'] },
    totem: { name: 'Storm Totem', footprint: [1, 1], grants: [{ id: 'electricAura', target: { kind: 'area', shape: 'rays', directions: ['up', 'down', 'left', 'right'], range: 1, tags: ['weapon'], ownerOnly: true }, abilities: ['shockHit'] }] }
  }
}
