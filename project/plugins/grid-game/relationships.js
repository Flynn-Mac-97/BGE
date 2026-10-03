/** Relationships are directed records, separate from item identity and activation order. */
import { placedItems } from './grid.js'
import { targets, reference, isAlive } from './targets.js'

/** Rebuild on demand in planning; fights retain fixed recipients and check source survival live. */
export function relationshipGraph(state, catalog) {
  const nodes = placedItems(state).map(item => item.id), edges = [], outgoing = Object.fromEntries(nodes.map(id => [id, []]))
  for (const id of nodes) {
    const source = reference('item', id), definition = catalog.items[state.items[id].type]
    for (const [index, aura] of definition.auras.entries()) for (const target of targets({ state, catalog, source }, aura.target)) {
      const edge = { kind: 'statAura', from: id, to: target, id: String(index), stat: aura.stat, amount: aura.amount }
      outgoing[id].push(edges.length); edges.push(edge)
    }
    for (const grant of definition.grants ?? []) for (const target of targets({ state, catalog, source }, grant.target)) {
      const edge = { kind: 'grant', from: id, to: target, id: grant.id, abilities: grant.abilities }
      outgoing[id].push(edges.length); edges.push(edge)
    }
  }
  return { nodes, edges, outgoing }
}

/** Each source contributes once per recipient; separate emitters have independent ability limits. */
export function grantedEntries(state, catalog, graph) {
  const entries = []
  if (!graph && !placedItems(state).some(item => catalog.items[item.type].grants?.length)) return entries
  graph ??= relationshipGraph(state, catalog)
  for (const edge of graph.edges) {
    if (edge.kind !== 'grant') continue
    const grantor = reference('item', edge.from)
    for (const ability of edge.abilities) entries.push({ source: edge.to, grantor, ability: { ...ability, id: JSON.stringify([edge.from, edge.id, ability.id]) }, statusId: null, status: null })
  }
  return entries
}

/** Dead or unequipped emitters cannot contribute queued grants. */
export function activeGrant(state, grantor) {
  return !grantor || (!!state.items[grantor.id].position && isAlive(state, grantor))
}
