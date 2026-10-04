/** Duel Pit rule cards. Each card cycles through its options; the first option listed is not special, `start` is the default. */
export const duelRuleCards = {
  items: { label: 'Items each', options: [3, 4, 5, 6], start: 4 },
  level: { label: 'Item level', options: [1, 3, 5, 8], start: 3 },
  columns: { label: 'Grid columns', options: [3, 4, 5, 6], start: 4 },
  health: { label: 'Hero health', options: [20, 40, 80], start: 40 },
  shelf: { label: 'Shelf', options: ['everything', 'random 8'], start: 'everything' },
  evolved: { label: 'Evolved items', options: ['off', 'on'], start: 'off' },
  forged: { label: 'Forged items', options: ['on', 'off'], start: 'on' },
  suddenDeath: { label: 'Sudden death from cycle', options: ['off', 6, 10], start: 10 }
}

/** The rule set every new session starts with. */
export const startingRules = () => Object.fromEntries(Object.entries(duelRuleCards).map(([id, card]) => [id, card.start]))

/** The rule set with one card moved to its next option. */
export function nextRule(ruleSet, id) {
  const card = duelRuleCards[id]
  if (!card) return ruleSet
  return { ...ruleSet, [id]: card.options[(card.options.indexOf(ruleSet[id]) + 1) % card.options.length] }
}
