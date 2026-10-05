/**
 * Item mastery: permanent growth for each item type, earned across runs.
 * The profile keeps `mastery: { type: xp }`. A run gains 1 xp for an item type for every floor won with it on the grid
 * (`run.masteryGain`), banked when the run is settled. Each mastery level adds `tuning.mastery.share` to every number the item has.
 */
import { tuning } from './tuning.js'

/** The mastery level for an amount of xp: level L needs step × L × (L + 1) / 2 xp in all. */
export const masteryLevel = xp => Math.floor((Math.sqrt(1 + 8 * (xp ?? 0) / tuning.mastery.step) - 1) / 2)

/** The xp the next mastery level needs in all. */
export const nextMasteryXp = level => tuning.mastery.step * (level + 1) * (level + 2) / 2

/** Mastery levels by item type, from a profile's xp: `{ type: level }`, only types at level 1 or more. */
export function masteryLevels(mastery = {}) {
  return Object.fromEntries(Object.entries(mastery).map(([type, xp]) => [type, masteryLevel(xp)]).filter(([, level]) => level > 0))
}

/** Count a won floor: 1 xp for each item type on the grid. */
export function gainMastery(run, placedTypes) {
  run.masteryGain ??= {}
  for (const type of new Set(placedTypes)) run.masteryGain[type] = (run.masteryGain[type] ?? 0) + 1
}

/** Add a run's gains to the profile's xp. */
export function bankMastery(profile, run) {
  profile.mastery ??= {}
  for (const [type, xp] of Object.entries(run.masteryGain ?? {})) profile.mastery[type] = (profile.mastery[type] ?? 0) + xp
}
