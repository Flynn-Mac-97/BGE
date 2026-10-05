/** Semantic image IDs stay separate from item rules and survive renaming a concept. */
import { artLabel, extraArt } from './art-library.js'
import { labArt } from './catalog/lab.js'
import { evolvedArt } from './descent/evolutions.js'
import { rules } from './rules.js'
export const portraitIds = ['rook', 'nettle', 'pip', 'toll', 'moss', 'innkeeper', 'cellarRat', 'graveRobber', 'venomLeech', 'cellarBrute', 'rustedSentry', 'venomKeeper', 'graveEnforcer', 'cellarWarden']
export const itemIds = ['dagger', 'sword', 'hammer', 'buckler', 'venom', 'salve', 'stone', 'tooth', 'hungryTooth', 'bloodCup', 'salt', 'banner', 'echo', 'sprig', 'pouch', 'pack', 'rootTotem', 'stormTotem', 'curseIdol', 'reapingSeal', 'salvagePack', 'patchKit']
export const artLibrary = [...extraArt, ...portraitIds.map(id => ({ id, kind: 'portrait', category: 'Original set', label: artLabel(id) })), ...itemIds.map(id => ({ id, kind: 'item', category: 'Original set', label: artLabel(id) }))]
export const artIds = artLibrary.map(entry => entry.id)
/** Filters change the gallery only; any concept may use any of the images. */
export const artChoices = ({ kind = 'all', category = 'all', query = '' } = {}) => artLibrary.filter(entry => (kind === 'all' || entry.kind === kind) && (category === 'all' || entry.category === category) && `${entry.label} ${entry.id} ${entry.category}`.toLowerCase().includes(query.trim().toLowerCase()))
export const artCategories = kind => [...new Set(artChoices({ kind }).map(entry => entry.category))]
const enemies = { 'Cellar Rat': 'cellarRat', 'Grave Robber': 'graveRobber', 'Venom Leech': 'venomLeech', 'Cellar Brute': 'cellarBrute', 'Rusted Sentry': 'rustedSentry', 'Venom Keeper': 'venomKeeper', 'Grave Enforcer': 'graveEnforcer', 'Cellar Warden': 'cellarWarden', 'Armoured Dummy': 'rustedSentry' }
export const enemyPortrait = name => enemies[name] ?? 'graveRobber'
export const art = (kit, id, label = '') => {
  const image = rules.catalog.items[id]?.art ?? labArt[id] ?? evolvedArt[id] ?? id
  return kit.portrait(`ink/${artIds.includes(image) ? image : 'innkeeper'}.png`, { alt: label, class: 'ink-art' })
}
