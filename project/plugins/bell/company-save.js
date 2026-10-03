/** Browser storage is confined to this boundary; invalid saves are retained instead of overwritten. */
import { adventurers, traits, createCompany } from './campaign.js'
import { rules } from './rules.js'
import { assertState } from '../grid-game/state.js'
export const companySaveKey = 'black-bell-company-v1'
const count = value => Number.isInteger(value) && value >= 0
function validate(company) {
  if (company?.version !== 1 || !count(company.coins) || !count(company.cleared) || !count(company.bestDepth) || !company.roster || Array.isArray(company.roster) || typeof company.roster !== 'object' || typeof company.notice !== 'string') throw new Error('Invalid company save')
  for (const [id, member] of Object.entries(company.roster)) {
    if (!adventurers[id] || member.id !== id || !count(member.experience) || !count(member.injuries) || !count(member.expeditions) || (member.trait !== null && !traits[member.trait]) || !Array.isArray(member.kit)) throw new Error('Invalid recruit save')
    rules.createState({ actors: { recruit: { team: 'crew', maxHealth: 12 } }, items: member.kit.map(item => ({ ...item, owner: 'recruit' })) })
    for (const item of member.kit) if (item.refinement && (!['damage', 'heal', 'guard'].includes(item.refinement.stat) || item.refinement.amount !== 1)) throw new Error('Invalid item refinement')
  }
  if (company.active) {
    if (!company.roster[company.active.expedition?.recruit] || !count(company.active.room) || !count(company.active.nextItem) || !['battle', 'reward', 'defeat', 'expeditionComplete'].includes(company.active.phase)) throw new Error('Invalid expedition save')
    assertState(company.active.battle, rules.catalog)
    if (company.active.battle.phase === 'resolving') throw new Error('Interrupted frame is not a stable save')
  }
  return company
}
/** No account or network is required. A blocked/invalid store produces a visible session-only warning. */
export function companyStore(storage) {
  let warning = '', blocked = false
  return {
    load() {
      try { return storage?.getItem(companySaveKey) ? validate(JSON.parse(storage.getItem(companySaveKey))) : createCompany() }
      catch { blocked = true; warning = 'Existing save could not be read. It has been preserved; this session will not replace it.'; return createCompany() }
    },
    save(company) {
      if (blocked) return false
      try { if (!storage) throw new Error('No storage'); storage.setItem(companySaveKey, JSON.stringify(company)); warning = ''; return true }
      catch { warning = 'Progress is only in this session: device storage is unavailable.'; return false }
    },
    warning: () => warning
  }
}
