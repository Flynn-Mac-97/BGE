/** Descent screens in the monochrome text style: the Lantern hub, the run header, cards, chest and summary. */
import { art } from '../art.js'
import { familyEmblem } from '../power-families.js'
import { rules, itemReference } from '../rules.js'
import { escape } from '../inspection.js'
import { shortStat } from '../glance.js'
import { tuning } from './tuning.js'
import { descentCrew } from './pool.js'
import { towerUpgrades, upgradeCost, isEndless } from './tower.js'
import { masteryLevel, nextMasteryXp } from './mastery.js'
import { evolutionRecipes } from './evolutions.js'
import { unlockedCrew } from './profile-save.js'
import { sellPrice } from './peddler.js'
import { familyPowers, familyPowerThresholds, familyCounts } from './family-powers.js'
import { powerFamilies } from '../power-families.js'
import { embersNeeded, regionOf, cardStats, recipeFor, readyEvolutions, maxHealthOf, chargesLeft, tomeNames } from './run.js'

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
    const rank = profile.tower[id] ?? 0, cost = upgradeCost(id, rank)
    const marks = isEndless(id) ? `RANK ${rank}` : pips(rank, upgrade.cost.length)
    return `<li><strong>${escape(upgrade.name)}</strong> <span class="tower-pips">${marks}</span><br><small>${escape(upgrade.text)}${isEndless(id) ? ' per rank' : ''}</small>${cost === null ? '<small> · MAX</small>' : button(`Ring · ${cost} Bells`, 'buy', id, profile.bells < cost || !!run)}</li>`
  }).join('')
  const masters = Object.entries(profile.mastery ?? {}).sort((first, second) => second[1] - first[1]).slice(0, 8).map(([type, xp]) => {
    const level = masteryLevel(xp)
    return `<li class="hub-kit">${art(kit, type, itemName(type))}<span>${escape(itemName(type))} · ✦${level}<br><small>${xp}/${nextMasteryXp(level)} floors · +${Math.round(level * tuning.mastery.share * 100)}%</small></span></li>`
  }).join('')
  return `<main class="tavern-game descent-hub"><header><strong>THE LAST LANTERN</strong><span>${profile.bells} BELLS · DEEPEST FLOOR ${profile.bestFloor} · ${profile.runs} RUN${profile.runs === 1 ? '' : 'S'}</span><div>${button('The Forge', 'openForge')}${button('Duel Pit', 'openDuel')}${button('Play Log', 'openLog')}${button('Family Lab', 'openLab')}${button('Scribe’s Bench', 'openCrafter')}</div></header><section class="tavern-story" role="status"><p>${escape(state.hubNotice)}</p>${state.saveWarning ? `<p>${escape(state.saveWarning)}</p>` : ''}</section><section class="descent-hub-body"><aside><h2>WHO GOES DOWN</h2>${roster}</aside><article><div class="tavern-portrait">${art(kit, crew.portrait, crew.name)}</div><h2>${escape(crew.name.toUpperCase())}, ${escape(crew.title)}</h2><p>${escape(crew.line)}</p><h3>STARTING KIT</h3><ul class="hub-kit-list">${kitList}</ul>${go}${run ? button('Abandon that run', 'abandon') : ''}</article><aside><h2>THE BELL TOWER</h2><p><small>Bells come back with every run. Each rank lasts forever.</small></p><ul class="tower-list">${tower}</ul><h2>ITEM MASTERY</h2><p><small>Every floor won with an item on the grid trains it forever. Each ✦ adds ${Math.round(tuning.mastery.share * 100)}% to all its numbers in every run.</small></p><ul class="hub-kit-list">${masters || '<li><small>Win a floor to start.</small></li>'}</ul></aside></section></main>`
}

/** The run line above the stage: region, floor, level, Embers, Bells and rerolls. */
export function runHeader(kit, journey) {
  const run = journey.descent
  const need = embersNeeded(run.level + run.pendingLevels)
  const kind = { normal: '', elite: ' · ELITE', boss: ' · BOSS' }[run.enemy.kind]
  return `<span><span class="run-region">THE DESCENT · ${escape(regionOf(run.floor).name.toUpperCase())} · </span>FLOOR ${run.floor}${kind} · LV ${run.level} · ${run.coin ?? 0} COIN · ${run.bells} BELLS</span><div class="ember-meter"><small>EMBERS ${run.embers}/${need}</small>${kit.bar(run.embers, { max: need, trail: false })}</div>`
}

/** Small marks on a grid item: its level, and a star when it can evolve at the next chest. */
export function levelBadge(journey, id, readyIds) {
  const item = journey.descent.items[id]
  if (!item) return ''
  const isEvolved = rules.catalog.items[item.type].tags.includes('evolved')
  const left = chargesLeft(item)
  const charges = left === null ? '' : `<span class="charge-badge ${item.readied ? 'readied' : left ? '' : 'spent'}">${item.readied ? 'READY' : '◆'.repeat(left) || 'EMPTY'}</span>`
  const mastery = journey.descent.mastery?.[item.type] ?? 0
  return `<span class="level-badge ${isEvolved ? 'evolved' : ''}">L${item.level}${mastery ? ` ✦${mastery}` : ''}${readyIds.has(id) ? ' ★' : item.level >= tuning.evolveLevel - 2 && recipeFor(item.type) ? ' ⇄' : ''}</span>${charges}`
}
/** Each family's count on the grid and its power, lit at 3 and doubled at 5. */
export function familyPowerList(kit, battle) {
  const counts = familyCounts(battle)
  const rows = Object.keys(powerFamilies).map(family => {
    const count = counts[family], [first, second] = familyPowerThresholds
    const state = count >= second ? 'doubled' : count >= first ? 'active' : ''
    const label = state === 'doubled' ? '×2' : state ? 'ON' : `${count}/${first}`
    return `<li class="family-power ${state}" title="${escape(familyPowers[family].text)}">${familyEmblem(kit, { tags: [family] })}<span><b>${escape(familyPowers[family].title)}</b> ${label}<small>${escape(familyPowers[family].text)}</small></span></li>`
  }).join('')
  return `<ul class="family-powers">${rows}</ul>`
}

/** From level 3, what each placed item still needs to evolve: `[{ id, text, isReady }]`. */
export function evolutionHints(journey) {
  const ready = readyIds(journey)
  return Object.entries(journey.descent.items).flatMap(([id, item]) => {
    const recipe = recipeFor(item.type)
    if (!recipe || item.level < tuning.evolveLevel - 2 || !journey.battle.items[id]?.position) return []
    const isOwned = Object.values(journey.descent.items).some(other => other.type === recipe.partner)
    const isTouching = rules.targets(journey.battle, itemReference(id), { kind: 'adjacentItems', ownerOnly: true }).some(target => journey.battle.items[target.id].type === recipe.partner)
    const need = ready.has(id) ? 'evolves at the next chest' : isTouching ? `reach L${tuning.evolveLevel}` : isOwned ? `touch ${itemName(recipe.partner)}` : `find ${itemName(recipe.partner)}`
    return [{ id, text: `${itemName(item.type)} L${item.level} → ${itemName(recipe.into)}: ${need}.`, isReady: ready.has(id) }]
  })
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
    return { image: item.type, type: item.type, title: itemName(item.type), sub: `LEVEL ${item.level} → ${item.level + 1}`, text: changes, hint: evolutionHint(run, item.type) }
  },
  item: (run, card) => ({ image: card.type, type: card.type, title: itemName(card.type), sub: `NEW · ${rules.catalog.items[card.type].footprint.join('×')}`, text: rules.catalog.items[card.type].description, hint: evolutionHint(run, card.type) }),
  widen: run => ({ image: 'pack', title: 'Wider Back', sub: `GRID ${run.columns} → ${run.columns + 1} COLUMNS`, text: 'Room for one more column of gear.', hint: '' }),
  tome: (run, card) => ({ image: 'boundBook', title: tomeNames[card.id], sub: `TOME · READ ${run.tomes?.[card.id] ?? 0} → ${(run.tomes?.[card.id] ?? 0) + 1}`,
    text: card.id === 'vigor' ? `+${tuning.tomes.vigor.health} max HP for the rest of the run.` : `+${tuning.tomes.might.bonus} to every number on all your gear, now and for every item you find.`, hint: '' }),
  mend: run => ({ image: 'salve', title: 'Mend', sub: 'REST ON THE STAIR', text: `Recover ${Math.round(maxHealthOf(run) * tuning.cards.mendShare)} health.`, hint: '' })
}

/** One owned item as a small card: picture, name with its family symbol, level, and one action button. */
function gearCard(kit, run, id, button) {
  const item = run.items[id], definition = rules.catalog.items[item.type]
  const changes = cardStats(run, { kind: 'level', id }).map(change => `${shortStat(change.stat)} ${change.from} → ${change.to}`).join(' · ')
  return `<section class="loot-card descent-card gear-card">${art(kit, item.type, definition.name)}<strong>${escape(definition.name)}${familyEmblem(kit, definition)}</strong><small>LEVEL ${item.level}${changes ? ' · ' + escape(changes) : ''}</small>${button}</section>`
}

const overlays = {
  train: (kit, journey) => {
    const run = journey.descent
    const gear = Object.keys(run.items).map(id => gearCard(kit, run, id, kit.button('Train +1', { action: 'train', value: id }))).join('')
    return `<div class="menu-shade"><section class="loot-sheet"><h2>TRAIN ONE ITEM · +1 LEVEL</h2><p>${escape(journey.message)} Pick the item you want stronger.</p><div class="loot-choices gear-choices">${gear}</div></section></div>`
  },
  peddler: (kit, journey) => {
    const run = journey.descent, coin = run.coin ?? 0
    const isFull = Object.keys(run.items).length >= tuning.cards.maxItems
    const wares = run.peddler.stock.map((ware, index) => {
      const definition = rules.catalog.items[ware.type]
      const label = ware.kind === 'evolved' ? 'EVOLVED · ONLY HERE' : ware.kind === 'consumable' ? 'CONSUMABLE' : `LEVEL ${ware.level}`
      const hint = evolutionHint(run, ware.type)
      return `<section class="loot-card descent-card">${art(kit, ware.type, definition.name)}<strong>${escape(definition.name)}${familyEmblem(kit, definition)}</strong><small>${label}</small><p>${escape(definition.description)}</p>${hint ? `<p class="card-hint">${escape(hint)}</p>` : ''}${kit.button(`Buy · ${ware.price} Coin`, { action: 'peddlerBuy', value: index, isDisabled: coin < ware.price || isFull })}</section>`
    }).join('')
    const gear = Object.keys(run.items).map(id => gearCard(kit, run, id, kit.button(`Sell · ${sellPrice(run.items[id])} Coin`, { action: 'peddlerSell', value: id, isDisabled: Object.keys(run.items).length < 2 }))).join('')
    return `<div class="menu-shade"><section class="loot-sheet peddler-sheet"><h2>THE TRAVELLING PEDDLER · ${coin} COIN</h2><p>${escape(journey.message)}${isFull ? ' Your back is full: sell something to buy.' : ''}</p><h3>HIS WARES</h3><div class="loot-choices">${wares || '<p>He has nothing left to sell.</p>'}</div><h3>YOUR GEAR</h3><div class="loot-choices gear-choices">${gear}</div>${kit.button('Go down the stair', { action: 'peddlerLeave', kind: 'primary' })}</section></div>`
  },
  levelUp: (kit, journey) => {
    const run = journey.descent
    const cards = run.cards.map((card, index) => {
      const face = cardFaces[card.kind](run, card)
      return `<section class="loot-card descent-card">${art(kit, face.image, face.title)}<strong>${escape(face.title)}${face.type ? familyEmblem(kit, rules.catalog.items[face.type]) : ''}</strong><small>${escape(face.sub)}</small><p>${escape(face.text)}</p>${face.hint ? `<p class="card-hint">${escape(face.hint)}</p>` : ''}${kit.button('Take', { action: 'card', value: index })}</section>`
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
    return `<div class="menu-shade"><section class="loot-sheet"><h2>THE LANTERN GOES OUT</h2><p>${escape(journey.message)}</p><ul class="run-summary"><li>Floor reached · ${run.floor}</li><li>Level · ${run.level}</li><li>Evolutions · ${run.evolutions}</li><li>Bells earned · ${run.bells}${run.floor > (run.bestBefore ?? 0) ? ' · NEW RECORD' : ''}</li><li>Deepest floor · ${state.profile.bestFloor}</li>${Object.keys(run.masteryGain ?? {}).length ? `<li>Mastery · ${Object.entries(run.masteryGain).map(([type, xp]) => `${escape(itemName(type))} +${xp}`).join(', ')}</li>` : ''}</ul><p><small>Spend Bells at the Bell Tower; mastery stays with each item for every run.</small></p>${kit.button('Return to the Lantern', { action: 'lantern' })}</section></div>`
  }
}

/** The overlay for the current run phase, or '' while fighting. */
export const runOverlay = (kit, journey, state) => overlays[journey.phase]?.(kit, journey, state) ?? ''

