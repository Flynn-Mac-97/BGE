/**
 * The Descent profile and its one storage boundary.
 * Profile: `{ version: 1, bells, bestFloor, runs, tower: { upgradeId: rank }, mastery: { itemType: xp }, forged: [record], duels: [record], history: [run record, newest first], journey }`, where `journey` is the active run or null.
 * Saves from before the Forge and the Duel Pit load with empty `forged` and `duels`.
 * An unreadable save is kept, not overwritten, and the session runs without saving.
 */
import { rules } from '../rules.js'
import { assertState } from '../../grid-game/state.js'
import { descentCrew } from './pool.js'
import { towerUpgrades, upgradeCost } from './tower.js'
import { bankMastery } from './mastery.js'
import { isForgeValid, registerForged, forgeLimit } from './forge.js'
import { runRecord, HISTORY_LIMIT } from './play-log.js'

export const profileSaveKey = 'black-bell-descent-v1'
/** A fresh profile. */
export const createProfile = () => ({ version: 1, bells: 0, bestFloor: 0, runs: 0, tower: {}, mastery: {}, forged: [], duels: [], history: [], journey: null })
const count = value => Number.isInteger(value) && value >= 0

function validate(profile) {
  if (profile?.version !== 1 || !count(profile.bells) || !count(profile.bestFloor) || !count(profile.runs) || typeof profile.tower !== 'object' || Array.isArray(profile.tower)) throw new Error('Invalid profile')
  for (const [id, rank] of Object.entries(profile.tower)) if (!towerUpgrades[id] || !count(rank) || rank > (towerUpgrades[id].cost?.length ?? Infinity)) throw new Error('Invalid tower rank')
  profile.mastery ??= {}
  if (typeof profile.mastery !== 'object' || !Object.values(profile.mastery).every(count)) throw new Error('Invalid mastery')
  profile.forged ??= []
  profile.duels ??= []
  profile.history ??= []
  if (!Array.isArray(profile.forged) || profile.forged.length > forgeLimit || !profile.forged.every(record => /^forged\d+$/.test(record.id) && isForgeValid(record)) || !Array.isArray(profile.duels) || !Array.isArray(profile.history)) throw new Error('Invalid forge or duel records')
  // Forged items must be in the rules before a saved run that carries them is checked.
  registerForged(profile.forged)
  const journey = profile.journey
  if (!journey) return profile
  if (!descentCrew[journey.descent?.crew] || !['battle', 'levelUp', 'train', 'chest', 'peddler', 'dead'].includes(journey.phase)) throw new Error('Invalid run')
  for (const item of Object.values(journey.descent.items)) if (!rules.catalog.items[item.type] || !count(item.level)) throw new Error('Invalid run item')
  assertState(journey.battle, rules.catalog)
  if (journey.battle.phase === 'resolving') throw new Error('Interrupted frame is not a stable save')
  return profile
}

/** Load and save the profile through a Storage-like object; `warning()` explains why progress is not saved. */
export function profileStore(storage) {
  let warning = '', isBlocked = false
  return {
    load() {
      try { return storage?.getItem(profileSaveKey) ? validate(JSON.parse(storage.getItem(profileSaveKey))) : createProfile() }
      catch { isBlocked = true; warning = 'Your Descent save could not be read. It has been kept; this session will not replace it.'; return createProfile() }
    },
    save(profile) {
      if (isBlocked) return false
      try { if (!storage) throw new Error('No storage'); storage.setItem(profileSaveKey, JSON.stringify(profile)); warning = ''; return true }
      catch { warning = 'Progress is only in this session: device storage is unavailable.'; return false }
    },
    warning: () => warning
  }
}

/** Bank a finished run once: Bells, best floor and the run count. Returns the Bells banked, or 0 if already banked. */
export function settleRun(profile, journey) {
  const run = journey.descent
  if (journey.phase !== 'dead' || run.settled) return 0
  run.settled = true
  profile.bells += run.bells
  profile.bestFloor = Math.max(profile.bestFloor, run.floor)
  profile.runs++
  bankMastery(profile, run)
  profile.history = [runRecord(run), ...profile.history].slice(0, HISTORY_LIMIT)
  return run.bells
}

/** Buy the next rank of a Bell Tower upgrade. */
export function buyUpgrade(profile, id) {
  const upgrade = towerUpgrades[id]
  const rank = profile.tower[id] ?? 0
  const cost = upgrade ? upgradeCost(id, rank) : null
  if (cost === null || profile.bells < cost || profile.journey) return false
  profile.bells -= cost
  profile.tower[id] = rank + 1
  return true
}

/** Crew this profile has reached. */
export const unlockedCrew = profile => Object.keys(descentCrew).filter(id => profile.bestFloor >= descentCrew[id].unlock)
