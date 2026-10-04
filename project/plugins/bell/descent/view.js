/** Descent screens in the monochrome text style: the Lantern hub, the run header, cards, chest and summary. */
import { art } from '../art.js'
import { rules } from '../rules.js'
import { escape } from '../inspection.js'
import { shortStat } from '../glance.js'
import { tuning } from './tuning.js'
import { descentCrew } from './pool.js'
import { towerUpgrades } from './tower.js'
import { evolutionRecipes } from './evolutions.js'
import { unlockedCrew } from './profile-save.js'
import { embersNeeded, regionOf, cardStats, recipeFor, readyEvolutions, maxHealthOf, chargesLeft, itemStat } from './run.js'
import { tomePrice, canBuyTomes } from './tomes.js'

const itemName = type => rules.catalog.items[type].name
const pips = (filled, total) => '●'.repeat(filled) + '○'.repeat(total - filled)

/** The start screen: crew, the Bell Tower, and the way down. */
export function hubView(kit, state) {
  const profile = state.profile, selected = state.crewSelected
  const crew = descentCrew[selected]
  const unlocked = unlockedCrew(profile)
  const button = (label, action, value, isDisabled = false) => kit.button(label, { action, value, isDisabled })
  const roster = Object.entries(descentCrew).map(([id, member]) => button(`${member.name}, ${member.title}\n${unlocked.includes(id) ? 'READY' : 'REACH FLOOR ' + member.unlock}`, 'crew', id)).join('')
  const kitList = crew.kit.map(([type]) => `<li class="hub-kit">${art(kit, type, itemName(type))}<span>${escape(itemName(type))}</span></li>`).join('')
  const run = profile.journey?.descent
  const go = run ? button(`Continue · ${descentCrew[run.crew].name} on floor ${run.floor}`, 'continueRun') : button(unlocked.includes(selected) ? `Descend with ${crew.name}` : `Reach floor ${crew.unlock} to meet ${crew.name}`, 'goDown', selected, !unlocked.includes(selected))
  const tower = Object.entries(towerUpgrades).map(([id, upgrade]) => {
    const rank = profile.tower[id] ?? 0, cost = upgrade.cost[rank]
    return `<li><strong>${escape(upgrade.name)}</strong> <span class="tower-pips">${pips(rank, upgrade.cost.length)}</span><br><small>${escape(upgrade.text)}</small>${cost === undefined ? '<small> · MAX</small>' : button(`Ring · ${cost} Bells`, 'buy', id, profile.bells < cost || !!run)}</li>`
  }).join('')
  return `<main class="tavern-game descent-hub"><header><strong>THE LAST LANTERN</strong><span>${profile.bells} BELLS · DEEPEST FLOOR ${profile.bestFloor} · ${profile.runs} RUN${profile.runs === 1 ? '' : 'S'}</span><div>${button('The Forge', 'openForge')}${button('Duel Pit', 'openDuel')}${button('Play Log', 'openLog')}${button('Family Lab', 'openLab')}${button('Scribe’s Bench', 'openCrafter')}</div></header><section class="tavern-story" role="status"><p>${escape(state.hubNotice)}</p>${state.saveWarning ? `<p>${escape(state.saveWarning)}</p>` : ''}</section><section class="descent-hub-body"><aside><h2>WHO GOES DOWN</h2>${roster}</aside><article><div class="tavern-portrait">${art(kit, crew.portrait, crew.name)}</div><h2>${escape(crew.name.toUpperCase())}, ${escape(crew.title)}</h2><p>${escape(crew.line)}</p><h3>STARTING KIT</h3><ul class="hub-kit-list">${kitList}</ul>${go}${run ? button('Abandon that run', 'abandon') : ''}</article><aside><h2>THE BELL TOWER</h2><p><small>Bells come back with every run. Each rank lasts forever.</small></p><ul class="tower-list">${tower}</ul></aside></section></main>`
}

/** The run line above the stage: region, floor, level, Embers, Bells and rerolls. */
export function runHeader(kit, journey) {
  const run = journey.descent
  const need = embersNeeded(run.level + run.pendingLevels)
  const kind = { normal: '', elite: ' · ELITE', boss: ' · BOSS' }[run.enemy.kind]
  return `<span><span class="run-region">THE DESCENT · ${escape(regionOf(run.floor).name.toUpperCase())} · </span>FLOOR ${run.floor}${kind} · LV ${run.level} · ${run.bells} BELLS</span><div class="ember-meter"><small>EMBERS ${run.embers}/${need}</small>${kit.bar(run.embers, { max: need, trail: false })}</div>`
}

/** Small marks on a grid item: its level, and a star when it can evolve at the next chest. */
export function levelBadge(journey, id, readyIds) {
  const item = journey.descent.items[id]
  if (!item) return ''
  const isEvolved = rules.catalog.items[item.type].tags.includes('evolved')
  const left = chargesLeft(item)
  const charges = left === null ? '' : `<span class="charge-badge ${item.readied ? 'readied' : left ? '' : 'spent'}">${item.readied ? 'READY' : '◆'.repeat(left) || 'EMPTY'}</span>`
  return `<span class="level-badge ${isEvolved ? 'evolved' : ''}">L${item.level}${readyIds.has(id) ? ' ★' : ''}${item.tomes ? ` +${item.tomes}` : ''}</span>${charges}`
}
/** Item ids ready to evolve now. */
export const readyIds = journey => new Set(readyEvolutions(journey).map(ready => ready.id))

function evolutionHint(run, type) {
  const recipe = recipeFor(type)
  if (recipe) return `Evolves at L${tuning.evolveLevel} touching ${itemName(recipe.partner)} → ${itemName(recipe.into)}.`
  const partnerOf = evolutionRecipes.find(other => other.partner === type)
  return partnerOf ? `Partner: helps ${itemName(partnerOf.from)} evolve.` : ''
}

const cardFaces = {
  level: (run, card) => {
    const item = run.items[card.id]
    const changes = cardStats(run, card).map(change => `${shortStat(change.stat)} ${change.from} → ${change.to}`).join(' · ')
    return { image: item.type, title: itemName(item.type), sub: `LEVEL ${item.level} → ${item.level + 1}`, text: changes, hint: evolutionHint(run, item.type) }
  },
  item: (run, card) => ({ image: card.type, title: itemName(card.type), sub: `NEW · ${rules.catalog.items[card.type].footprint.join('×')}`, text: rules.catalog.items[card.type].description, hint: evolutionHint(run, card.type) }),
  widen: run => ({ image: 'pack', title: 'Wider Back', sub: `GRID ${run.columns} → ${run.columns + 1} COLUMNS`, text: 'Room for one more column of gear.', hint: '' }),
  mend: run => ({ image: 'salve', title: 'Mend', sub: 'REST ON THE STAIR', text: `Recover ${Math.round(maxHealthOf(run) * tuning.cards.mendShare)} health.`, hint: '' })
}

const overlays = {
  levelUp: (kit, journey) => {
    const run = journey.descent
    const cards = run.cards.map((card, index) => {
      const face = cardFaces[card.kind](run, card)
      return `<section class="loot-card descent-card">${art(kit, face.image, face.title)}<strong>${escape(face.title)}</strong><small>${escape(face.sub)}</small><p>${escape(face.text)}</p>${face.hint ? `<p class="card-hint">${escape(face.hint)}</p>` : ''}${kit.button('Take', { action: 'card', value: index })}</section>`
    }).join('')
    const more = run.pendingLevels > 1 ? ` ${run.pendingLevels - 1} more after this.` : ''
    return `<div class="menu-shade"><section class="loot-sheet"><h2>${escape(descentCrew[run.crew].name.toUpperCase())} GREW TO LEVEL ${run.level + 1}! · CHOOSE ONE</h2><p>${escape(journey.message)}${more}</p><div class="loot-choices">${cards}</div>${kit.button(`Reroll · ${run.rerolls} left`, { action: 'reroll', isDisabled: run.rerolls < 1 })}</section></div>`
  },
  chest: (kit, journey) => {
    const chest = journey.descent.chest
    const body = chest.kind === 'evolution'
      ? `<p class="evolve-start">What? ${escape(itemName(chest.from))} is evolving!</p><div class="evolution-morph"><span class="morph-from">${art(kit, chest.from, itemName(chest.from))}</span><span class="morph-into">${art(kit, chest.into, itemName(chest.into))}</span></div><h3 class="evolve-done">${escape(itemName(chest.from))} became ${escape(itemName(chest.into)).toUpperCase()}!</h3><p class="evolve-done">${escape(rules.catalog.items[chest.into].description)}</p>`
      : `<ul>${chest.ups.map(up => `<li>${escape(itemName(up.type))} · level ${up.from} → ${up.to}</li>`).join('')}</ul>`
    return `<div class="menu-shade"><section class="loot-sheet"><h2>${chest.kind === 'evolution' ? 'THE CHEST OPENS · EVOLUTION' : 'THE CHEST OPENS'}</h2><p>${escape(journey.message)}</p>${body}${kit.button('Take it', { action: 'chest' })}</section></div>`
  },
  dead: (kit, journey, state) => {
    const run = journey.descent
    return `<div class="menu-shade"><section class="loot-sheet"><h2>THE LANTERN GOES OUT</h2><p>${escape(journey.message)}</p><ul class="run-summary"><li>Floor reached · ${run.floor}</li><li>Level · ${run.level}</li><li>Evolutions · ${run.evolutions}</li><li>Bells earned · ${run.bells}</li><li>Deepest floor · ${state.profile.bestFloor}</li></ul>${kit.button('Return to the Lantern', { action: 'lantern' })}</section></div>`
  }
}

/** The overlay for the current run phase, or '' while fighting. */
export const runOverlay = (kit, journey, state) => overlays[journey.phase]?.(kit, journey, state) ?? ''

/** The tome sheet: one Tome of Vigor for the hero, and a Tome of Might for each item. */
export function tomeSheet(kit, journey) {
  const run = journey.descent, isOpen = canBuyTomes(journey)
  const buy = (kind, id) => {
    const price = tomePrice(run, kind, id)
    return kit.button(`Read · ${price} Bells`, { action: 'buyTome', value: id ? `${kind}:${id}` : kind, isDisabled: !isOpen || run.bells < price })
  }
  const items = Object.entries(run.items).map(([id, item]) => {
    const definition = rules.catalog.items[item.type]
    const numbers = Object.entries(definition.stats).filter(([, base]) => base).map(([stat, base]) => `${shortStat(stat)} ${itemStat(base, item)}`).join(' · ')
    return `<li class="tome-row">${art(kit, item.type, definition.name)}<span><strong>${escape(definition.name)}</strong>${item.tomes ? ` <small>MIGHT ${item.tomes}</small>` : ''}<br><small>${escape(numbers)}</small></span>${buy('might', id)}</li>`
  }).join('')
  const hero = `<li class="tome-row">${art(kit, 'boundBook', 'Tome of Vigor')}<span><strong>TOME OF VIGOR</strong>${run.tomes?.vigor ? ` <small>READ ${run.tomes.vigor}</small>` : ''}<br><small>+${tuning.tomes.vigor.health} max HP for this run · now ${maxHealthOf(run)}</small></span>${buy('vigor')}</li>`
  const note = isOpen ? `${run.bells} BELLS · Bells spent here do not come home.` : 'Tomes can only be read before a fight starts.'
  return `<div class="menu-shade"><section class="loot-sheet tome-sheet"><h2>TOMES · ${escape(note)}</h2><ul class="tome-list">${hero}</ul><h3>TOME OF MIGHT · +${tuning.tomes.might.bonus} TO EVERY NUMBER ON ONE ITEM</h3><ul class="tome-list">${items}</ul>${kit.button('Close', { action: 'tomes' })}</section></div>`
}
