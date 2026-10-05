/** Fail at authoring boundaries instead of silently dropping a misspelled effect. */
import { selectorNames, conditionNames } from './targets.js'

export const effectNames = ['damage', 'heal', 'guard', 'applyStatus', 'removeStatus', 'modifyStat', 'resource', 'triggerItem', 'removeGuard', 'consumeStatus', 'transferResource', 'modifyCharges']
export const triggerNames = ['combatStart', 'cycleStart', 'cycleEnd', 'ownTurn', 'itemActivated', 'damageDealt', 'damageTaken', 'statusApplied']
export const durationNames = ['instant', 'nextAction', 'cycle', 'combat', 'whileAdjacent']
const positive = value => Number.isInteger(value) && value > 0
const fail = (path, message) => { throw new TypeError(`${path}: ${message}`) }
const dictionary = value => value && typeof value === 'object' && !Array.isArray(value)

function validateTarget(selector, path) {
  if (!selector || !selectorNames.includes(selector.kind)) fail(path, 'unknown target kind')
  if (selector.kind === 'directionalNeighbour' && !['right', 'left', 'up', 'down'].includes(selector.direction)) fail(path, 'direction must be right, left, up or down')
  if (selector.kind === 'area') {
    if (!['rays', 'row', 'column', 'radius'].includes(selector.shape)) fail(path, 'unknown area shape')
    if (selector.range !== undefined && (!positive(selector.range) || selector.range > 12)) fail(path, 'range must be 1–12')
    if (selector.directions && (!Array.isArray(selector.directions) || !selector.directions.length || selector.directions.some(direction => !['up', 'down', 'left', 'right'].includes(direction)))) fail(path, 'invalid directions')
  }
  if (selector.tags && (!Array.isArray(selector.tags) || selector.tags.some(tag => typeof tag !== 'string'))) fail(path, 'tags must be strings')
}
function validateAmount(amount, path) {
  if (typeof amount === 'number' && Number.isFinite(amount)) return
  if (dictionary(amount) && (amount.previous === true || amount.eventAmount === true) && Object.keys(amount).every(key => ['previous', 'eventAmount', 'scale'].includes(key)) && !(amount.previous && amount.eventAmount) && (amount.scale === undefined || (Number.isFinite(amount.scale) && amount.scale >= 0))) return
  if (dictionary(amount) && Number.isInteger(amount.roll) && amount.roll > 1 && Object.keys(amount).every(key => ['roll', 'scale'].includes(key)) && (amount.scale === undefined || (Number.isFinite(amount.scale) && amount.scale > 0))) return
  if (dictionary(amount) && Object.keys(amount).length === 1 && (typeof amount.stat === 'string' || typeof amount.grantorStat === 'string' || typeof amount.resource === 'string' || amount.stacks === true)) return
  fail(path, 'expected finite number or {stat}, {grantorStat}, {resource}, {stacks:true}, {roll}')
}
function validateCondition(condition, path, catalog) {
  if (!conditionNames.includes(condition.kind)) fail(path, 'unknown condition')
  if (condition.subject && !['self', 'selfItem', 'owner', 'enemy', 'eventSource', 'eventTarget'].includes(condition.subject)) fail(path, 'invalid condition subject')
  if (condition.kind === 'hasStatus' && !catalog.statuses[condition.status]) fail(path, 'unknown status')
  if (condition.kind === 'hasTag' && typeof condition.tag !== 'string') fail(path, 'tag required')
  if (condition.kind === 'resourceAtLeast' && (typeof condition.resource !== 'string' || !Number.isFinite(condition.amount) || condition.amount < 0)) fail(path, 'resource and nonnegative amount required')
  if (condition.kind === 'healthBelow' && !(Number.isFinite(condition.amount) || (Number.isFinite(condition.ratio) && condition.ratio >= 0 && condition.ratio <= 1))) fail(path, 'health amount or ratio required')
  if (['cycleAtLeast', 'cycleEvery'].includes(condition.kind) && !positive(condition.amount)) fail(path, 'positive cycle count required')
  if (condition.kind === 'eventAmountAtLeast' && (!Number.isFinite(condition.amount) || condition.amount < 0)) fail(path, 'nonnegative event amount required')
  if (condition.kind === 'cellEmpty' && !['right', 'left', 'up', 'down'].includes(condition.direction)) fail(path, 'direction required')
}

/** Abilities can be inline records or references to shared blocks in catalog.abilities. */
export function validateAbility(ability, path, catalog) {
  if (!ability || typeof ability.id !== 'string' || !ability.id) fail(path, 'ability id required')
  if (!triggerNames.includes(ability.trigger?.event)) fail(path, 'unknown trigger event')
  if (ability.trigger.source) validateTarget(ability.trigger.source, path + '.trigger.source')
  if (ability.trigger.target) validateTarget(ability.trigger.target, path + '.trigger.target')
  if (ability.trigger.status && !catalog.statuses[ability.trigger.status]) fail(path, 'unknown trigger status')
  validateTarget(ability.target, path + '.target')
  if (!Array.isArray(ability.effects) || !ability.effects.length) fail(path, 'effects required')
  for (const condition of ability.conditions ?? []) validateCondition(condition, path + '.condition', catalog)
  for (const effect of ability.effects) {
    if (!effectNames.includes(effect.type)) fail(path, `unknown effect ${effect.type}`)
    if (effect.target) validateTarget(effect.target, path + '.effect.target')
    if (effect.type !== 'triggerItem') validateAmount(effect.amount, path + '.' + effect.type)
    if (['applyStatus', 'removeStatus', 'consumeStatus'].includes(effect.type) && !catalog.statuses[effect.status]) fail(path, 'unknown effect status')
    if (effect.type === 'modifyStat' && typeof effect.stat !== 'string') fail(path, 'stat name required')
    if (['resource', 'transferResource'].includes(effect.type) && typeof effect.resource !== 'string') fail(path, 'resource name required')
    if (effect.type === 'transferResource') validateTarget(effect.from, path + '.from')
    if (effect.type === 'modifyCharges' && typeof effect.ability !== 'string') fail(path, 'charged ability id required')
    if (effect.duration && !durationNames.includes(effect.duration)) fail(path, 'unknown duration')
    if (effect.duration && effect.duration !== 'instant' && !['applyStatus', 'modifyStat'].includes(effect.type)) fail(path, 'duration belongs on a status or stat modifier')
    if (effect.type === 'applyStatus' && effect.duration === 'instant') fail(path, 'status needs an ongoing duration')
    if (effect.expires && !['cycle', 'combat'].includes(effect.expires)) fail(path, 'invalid fallback expiry')
  }
  for (const cost of ability.costs ?? []) {
    validateTarget(cost.target, path + '.cost.target')
    if (typeof cost.resource !== 'string' || !Number.isFinite(cost.amount) || cost.amount < 0) fail(path, 'invalid resource cost')
  }
  for (const limit of ['perCycle', 'perCombat', 'charges']) {
    if (ability.limit?.[limit] !== undefined && !positive(ability.limit[limit])) fail(path, `${limit} must be a positive integer`)
  }
  if (ability.limit?.refill && !ability.limit.charges) fail(path, 'charge refill needs charges')
  if (ability.limit?.refill && ability.limit.refill !== 'cycle') fail(path, 'charge refill must be cycle')
}

/** Expand shared ability references for items, statuses and actors. */
export function abilitiesOf(entries, catalog, path) {
  const abilities = (entries ?? []).map(entry => {
    if (typeof entry !== 'string') return structuredClone(entry)
    if (!catalog.abilities[entry]) fail(path, 'unknown ability block ' + entry)
    return { ...structuredClone(catalog.abilities[entry]), id: entry }
  })
  if (new Set(abilities.map(ability => ability.id)).size !== abilities.length) fail(path, 'duplicate ability id')
  for (const ability of abilities) validateAbility(ability, path, catalog)
  return abilities
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.values(value).forEach(freeze)
  return Object.freeze(value)
}

/** Compile a private immutable catalog; editing the input afterwards cannot change a run. */
export function compileCatalog(input) {
  const catalog = { items: {}, statuses: structuredClone(input.statuses ?? {}), abilities: structuredClone(input.abilities ?? {}) }
  if (!dictionary(input.items) || !Object.keys(input.items).length) fail('catalog.items', 'at least one item required')
  for (const [id, status] of Object.entries(catalog.statuses)) {
    if (!['add', 'replace', 'max'].includes(status.stacking ?? 'add')) fail(id, 'invalid status stacking')
    if (status.expires && !['cycle', 'combat'].includes(status.expires)) fail(id, 'invalid status fallback expiry')
    if (status.duration && (!durationNames.includes(status.duration) || status.duration === 'instant')) fail(id, 'invalid status duration')
    if (status.maxStacks !== undefined && (!Number.isFinite(status.maxStacks) || status.maxStacks <= 0)) fail(id, 'invalid stack cap')
    for (const modifier of status.modifiers ?? []) {
      if (typeof modifier.stat !== 'string') fail(id, 'status stat required')
      const isStacks = dictionary(modifier.amount) && modifier.amount.stacks === true && Object.keys(modifier.amount).every(key => ['stacks', 'scale'].includes(key)) && (modifier.amount.scale === undefined || Number.isFinite(modifier.amount.scale))
      if (!Number.isFinite(modifier.amount) && !isStacks) fail(id, 'status modifier supports a constant or {stacks:true, scale?}')
    }
    status.abilities = abilitiesOf(status.abilities, catalog, id)
  }
  for (const [id, item] of Object.entries(input.items)) {
    if (!Array.isArray(item.footprint) || item.footprint.length !== 2 || !item.footprint.every(positive)) fail(id, 'footprint must be [positive width, positive height]')
    if (item.storage && (!positive(item.storage.columns) || item.storage.columns > 9)) fail(id, 'storage columns must be an integer from 1 to 9')
    if (item.footprint.some(size => size > 12)) fail(id, 'footprint exceeds grid limit')
    if (typeof item.name !== 'string' || (!Array.isArray(item.tags ?? []) || (item.tags ?? []).some(tag => typeof tag !== 'string'))) fail(id, 'name and tags required')
    for (const value of Object.values({ ...item.stats, ...item.resources })) if (!Number.isFinite(value)) fail(id, 'stats/resources must be finite')
    for (const value of Object.values({ ...item.resources, ...item.resourceCaps })) if (!Number.isFinite(value) || value < 0) fail(id, 'resources and caps must be nonnegative')
    for (const [resource, amount] of Object.entries(item.resources ?? {})) if (amount > (item.resourceCaps?.[resource] ?? Infinity)) fail(id, 'resource exceeds its cap')
    for (const aura of item.auras ?? []) {
      validateTarget(aura.target, id + '.aura')
      if (typeof aura.stat !== 'string' || !(Number.isFinite(aura.amount) || (dictionary(aura.amount) && Object.keys(aura.amount).length === 1 && typeof aura.amount.stat === 'string'))) fail(id, 'aura needs stat and a constant or {stat} amount')
    }
    const grants = (item.grants ?? []).map(grant => {
      if (typeof grant.id !== 'string' || !grant.id) fail(id, 'grant id required')
      validateTarget(grant.target, id + '.grant')
      if (!['area', 'containerItems', 'adjacentItems', 'directionalNeighbour', 'allItems'].includes(grant.target.kind)) fail(id, 'grants require fixed item recipients')
      return { ...structuredClone(grant), abilities: abilitiesOf(grant.abilities, catalog, id + '.grant') }
    })
    if (new Set(grants.map(grant => grant.id)).size !== grants.length) fail(id, 'duplicate grant id')
    catalog.items[id] = { tags: [], stats: {}, resources: {}, resourceCaps: {}, auras: [], ...structuredClone(item), abilities: abilitiesOf(item.abilities, catalog, id), grants }
  }
  return freeze(catalog)
}
