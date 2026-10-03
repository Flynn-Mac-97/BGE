/** Campaign pacing and loot are editable data; combat abilities reuse the grid vocabulary. */
export const campaignRooms = [
  { name: 'Cellar Rat', mark: 'r', health: 4, damage: 1 },
  { name: 'Grave Robber', mark: 'x', health: 5, damage: 1 },
  { name: 'Venom Leech', mark: 'v', health: 5, damage: 1, poison: 1 },
  { name: 'Cellar Brute', mark: 'b', health: 8, damage: 2 },
  { name: 'Rusted Sentry', mark: 's', health: 8, damage: 2, guard: 1 },
  { name: 'Venom Keeper', mark: 'v', health: 8, damage: 1, poison: 1 },
  { name: 'Grave Enforcer', mark: 'e', health: 10, damage: 2, rage: 1 },
  { name: 'Cellar Warden', mark: 'W', health: 14, damage: 2, guard: 1, guardEvery: 2, rage: 1, rageEvery: 3 }
]
export function campaignEnemy(room) {
  const definition = campaignRooms[room - 1]
  if (!definition) throw new RangeError('Campaign room outside route')
  return { name: definition.name, mark: definition.mark, team: 'dungeon', maxHealth: definition.health, intent: [definition.poison ? 'Applies Poison.' : '', definition.guard ? `Gains ${definition.guard} guard every ${definition.guardEvery ?? 1} cycle(s).` : '', definition.rage ? `Attack rises by ${definition.rage} every ${definition.rageEvery ?? 1} cycle(s).` : ''].filter(Boolean).join(' '), stats: { damage: definition.damage }, abilities: [
    ...(definition.rage ? [{ id: 'roomRage', trigger: { event: 'cycleEnd' }, conditions: [{ kind: 'cycleEvery', amount: definition.rageEvery ?? 1 }], target: { kind: 'self' }, effects: [{ type: 'modifyStat', stat: 'damage', amount: definition.rage, duration: 'combat' }] }] : []),
    ...(definition.guard ? [{ id: 'roomGuard', trigger: { event: 'cycleStart' }, target: { kind: 'self' }, conditions: [{ kind: 'cycleEvery', amount: definition.guardEvery ?? 1 }], effects: [{ type: 'guard', amount: definition.guard }] }] : []),
    { id: 'enemyAttack', trigger: { event: 'ownTurn' }, target: { kind: 'enemy' }, effects: [{ type: 'damage', amount: { stat: 'damage' } }, ...(definition.poison ? [{ type: 'applyStatus', status: 'poison', amount: definition.poison }] : [])] }
  ] }
}
/** Later expeditions offer one kit partner plus varied finds, preferring things not owned. */
export const lootPartners = { dagger: ['stone', 'venom', 'stormTotem', 'rootTotem', 'banner'], hungryTooth: ['bloodCup'], bloodCup: ['hungryTooth'], curseIdol: ['reapingSeal'], reapingSeal: ['curseIdol'], salvagePack: ['patchKit'], patchKit: ['salvagePack'], venom: ['tooth'], stormTotem: ['hammer'], rootTotem: ['hammer'] }
export function campaignChoices(journey, catalog, random) {
  const owned = new Set(Object.values(journey.battle.items).map(item => item.type))
  const all = Object.keys(catalog.items)
  const partners = [...new Set([...owned].flatMap(type => lootPartners[type] ?? []))].filter(type => !owned.has(type))
  const fresh = all.filter(type => !owned.has(type))
  const choices = []
  const pick = pool => { const available = pool.filter(type => !choices.includes(type)); if (available.length) choices.push(available[Math.min(available.length - 1, Math.floor(Math.max(0, random()) * available.length))]) }
  pick(partners.length ? partners : fresh.length ? fresh : all)
  pick(fresh.length > 1 ? fresh : all)
  pick(all)
  while (choices.length < 3) pick(all)
  return choices
}
