/** Duel Pit screens: the rule cards and fun log, the draft panel, pass-the-phone, and the result with a fun rating. */
import { art } from '../art.js'
import { escape } from '../inspection.js'
import { placedItems } from '../../grid-game/grid.js'
import { descentCrew } from '../descent/pool.js'
import { duelRuleCards } from './duel-rules.js'
import { funByRule } from './duel.js'

const stars = average => '★'.repeat(Math.round(average)) + '☆'.repeat(3 - Math.round(average))
const ruleChips = ruleSet => Object.entries(duelRuleCards).map(([id, card]) => `<li>${escape(card.label)} · <b>${escape(String(ruleSet[id]))}</b></li>`).join('')

/** The rules screen: tap a card to change it, start a duel, and see which rules have been fun. */
export function duelRulesView(kit, state) {
  const ruleSet = state.duelRules, duels = state.profile.duels
  const cards = Object.entries(duelRuleCards).map(([id, card]) => kit.button(`${card.label}\n${ruleSet[id]}`, { action: 'duelRule', value: id, class: 'rule-card' })).join('')
  const fun = funByRule(duels).slice(0, 10).map(entry => `<li>${stars(entry.average)} <b>${escape(duelRuleCards[entry.rule]?.label ?? entry.rule)} · ${escape(String(entry.option))}</b> <small>${entry.count} duel${entry.count === 1 ? '' : 's'}</small></li>`).join('') || '<li><small>Rate a few duels and the best rules show here.</small></li>'
  const recent = duels.slice(0, 5).map(duel => `<li>${stars(duel.fun)} ${duel.winner === null ? 'Draw' : `P${duel.winner + 1} won`} in ${duel.cycles} cycles <small>${escape(duel.builds.map(build => build.length + ' items').join(' vs '))}</small></li>`).join('')
  return `<main class="tavern-game descent-hub duel-rules"><header><strong>THE DUEL PIT</strong><span>SAME SCREEN · TWO PLAYERS</span><div>${kit.button('Back to the Lantern', { action: 'hub' })}</div></header><section class="tavern-story" role="status"><p>Set the rules, then take turns drafting a build on this phone. After each fight, rate how fun it was; the Pit remembers which rules you liked.</p></section><section class="descent-hub-body duel-body"><article><h2>RULE CARDS</h2><div class="rule-cards">${cards}</div>${kit.button('Start duel · Player 1 drafts', { action: 'duelStart', kind: 'primary' })}</article><aside><h2>WHAT HAS BEEN FUN</h2><ul class="fun-list">${fun}</ul>${recent ? `<h3>LAST DUELS</h3><ul class="fun-list">${recent}</ul>` : ''}</aside></section></main>`
}

/** The header line for a duel. */
export function duelHeader(kit, journey) {
  const duel = journey.duel
  const names = duel.players.map((player, index) => `P${index + 1} ${descentCrew[player.portrait].name.toUpperCase()}`)
  const stages = {
    draft: () => `PLAYER ${duel.turn + 1} DRAFTING · ${placedItems(journey.battle).length}/${duel.rules.items} ON THE GRID`,
    handoff: () => 'PASS THE PHONE',
    fight: () => `${names[0]} VS ${names[1]} · CYCLE ${journey.battle.cycle}`,
    result: () => `${names[0]} VS ${names[1]} · RESULT`
  }
  return `<span>DUEL PIT · ${stages[duel.stage]()}</span>`
}

/** The stage while a player drafts: their hero, the rules, and how many items they may still place. */
export function duelDraftStage(kit, state) {
  const journey = state.journey, duel = journey.duel, player = duel.players[duel.turn]
  const placed = placedItems(journey.battle).length
  return `<div class="duel-draft"><div class="duel-drafter">${kit.target(art(kit, descentCrew[player.portrait].portrait, descentCrew[player.portrait].name), { action: 'duelHero', attributes: { class: 'drafter-portrait', 'aria-label': 'Change hero' } })}<div><h2>PLAYER ${duel.turn + 1} · ${escape(descentCrew[player.portrait].name.toUpperCase())}</h2><p class="duel-count">${placed} / ${duel.rules.items} ITEMS ON THE GRID</p><p><small>Tap the portrait to change hero. Tap an item on the shelf, then a cell. Tap READY when done.</small></p></div></div><ul class="rule-chips">${ruleChips(duel.rules)}</ul><p class="duel-hint">${escape(state.message || journey.message)}</p></div>`
}

/** Player 1 below, Player 2 above, both with their gear. */
export function duelCast(state) {
  const journey = state.journey, duel = journey.duel
  const fighter = (index, owner) => ({ portrait: descentCrew[duel.players[index].portrait].portrait, title: descentCrew[duel.players[index].portrait].name, tag: `P${index + 1}`, rank: index ? 'rival' : 'hero', meter: null, showNumbers: true, threats: [],
    gear: placedItems(journey.battle).filter(item => item.owner === owner).map(item => ({ type: item.type, level: duel.rules.level })) })
  return { key: `duel-${duel.fights ?? 0}`, idle: state.message || journey.message, hero: fighter(0, 'recruit'), foe: fighter(1, 'enemy') }
}

/** The main button: READY while drafting, FIGHT before the fight. */
export function duelPrimary(journey) {
  return journey.duel.stage === 'draft' ? { text: 'READY', action: 'duelReady' } : { text: 'FIGHT', action: 'fight' }
}

const overlays = {
  handoff: (kit, journey) => `<div class="menu-shade"><section class="loot-sheet duel-sheet"><h2>PASS THE PHONE TO PLAYER 2</h2><p>Player 1's build is locked in and hidden. Player 2, no peeking at the grid until you tap below.</p>${kit.button("I'm Player 2 · start drafting", { action: 'duelHandoff', kind: 'primary' })}</section></div>`,
  result: (kit, journey) => {
    const duel = journey.duel
    const winner = duel.winner === null ? null : duel.players[duel.winner]
    const banner = winner ? `<div class="duel-winner">${art(kit, descentCrew[winner.portrait].portrait, descentCrew[winner.portrait].name)}<div><h2>PLAYER ${duel.winner + 1} WINS!</h2><p>${escape(descentCrew[winner.portrait].name)} · ${journey.battle.cycle} cycles</p></div></div>` : `<h2>A DRAW</h2><p>${journey.battle.cycle} cycles.</p>`
    const rating = duel.rated ? '<p><b>Thanks. Rating saved.</b></p>' : `<h3>HOW FUN WAS THAT?</h3><div class="fun-buttons">${kit.button('Dull', { action: 'duelRate', value: 1 })}${kit.button('OK', { action: 'duelRate', value: 2 })}${kit.button('Great', { action: 'duelRate', value: 3 })}</div>`
    return `<div class="menu-shade"><section class="loot-sheet duel-sheet">${banner}${rating}<div class="duel-next">${kit.button('Fight again · same builds', { action: 'duelAgain' })}${kit.button('Both redraft', { action: 'duelRedraft' })}${kit.button('Change rules', { action: 'openDuel' })}${kit.button('Leave the Duel Pit', { action: 'hub' })}</div></section></div>`
  }
}

/** The overlay for the duel's stage, or '' while drafting or fighting. */
export const duelOverlay = (kit, journey) => overlays[journey.duel.stage]?.(kit, journey) ?? ''
