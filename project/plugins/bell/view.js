/** A landscape game field keeps the battle above inventory, with loot shown as a game overlay. */
import { art, enemyPortrait } from './art.js'
import { familyEmblem } from './power-families.js'
import { familyKits } from './family-lab.js'
import { cacheCost, findInterval } from './loop.js'
import { rules, itemDefinition } from './rules.js'
import { tooltip } from './tooltip.js'
import { equipmentFeedback, stageFeedback, damageFeedback } from './feedback.js'
import { activationOrder, connectionPreview, connectionLinks } from './connections.js'
import { itemGlance, firedGlance, edgeBadges } from './glance.js'
import { escape } from './inspection.js'
import { runHeader, runOverlay, levelBadge, readyIds, evolutionHints } from './descent/view.js'
import { battleStage, descentCast } from './descent/battle-stage.js'
import { duelCast, duelHeader, duelOverlay, duelDraftStage, duelPrimary } from './duel/view.js'
import { descentCrew } from './descent/pool.js'

function rewardOverlay(kit, journey) {
  const retreat = journey.expedition ? kit.button(journey.rewardKind === 'salvage' ? 'Take salvage & return to tavern' : 'Return without this find', { action: 'returnTavern' }) : ''
  if (journey.rewardKind === 'salvage') return `<div class="menu-shade"><section class="loot-sheet"><h2>ROOM CLEARED · SALVAGE</h2><p>${escape(journey.message)}</p>${kit.button('Gather salvage & descend', { action: 'descend' })}${retreat}</section></div>`
  return `<div class="menu-shade"><section class="loot-sheet"><h2>${journey.expedition && journey.cleared >= journey.expedition.goal ? 'WARDEN DEFEATED · CHOOSE A KEEPSAKE' : journey.rewardKind === 'room' ? 'VICTORY · CHOOSE YOUR FIND' : 'SCAVENGED CACHE'}</h2><p>${escape(journey.message)}</p><div class="loot-choices">${journey.choices.map(type => {
    const item = rules.catalog.items[type]
    return `<section class="loot-card">${art(kit, type, item.name)}<strong>${escape(item.name)}${familyEmblem(kit, item)}</strong><small>${item.storage ? item.storage.columns + '×3 container' : item.footprint.join('×') + ' slots'}</small><p>${escape(item.description)}</p>${kit.button('Keep ' + item.name, { action: 'claim', value: type })}</section>`
  }).join('')}</div>${retreat}</section></div>`
}
function glanceLines(battle, id) {
  const lines = itemGlance(battle, id).map(line => `<span class="glance-line ${line.isBoosted ? 'boosted' : ''}">${line.trigger ? `<span class="glance-trigger">${escape(line.trigger)}</span> ` : ''}${escape(line.text)}</span>`)
  return lines.length ? `<span class="glance">${lines.join('')}</span>` : ''
}
/** The portrait for a fighter: the crew member or enemy of a Descent run, or the older modes' choices. */
function portraitOf(journey, id, actor) {
  if (journey.descent) return id === 'enemy' ? journey.descent.enemy.portrait : descentCrew[journey.descent.crew].portrait
  return id === 'enemy' ? enemyPortrait(actor.name) : journey.expedition?.recruit ?? 'rook'
}
/** The Descent's evolution hints under the reserve, one line per item on its way. */
function evolveList(journey) {
  const hints = evolutionHints(journey)
  return hints.length ? `<ul class="evolve-hints">${hints.map(hint => `<li class="${hint.isReady ? 'ready' : ''}">${hint.isReady ? '★' : '⇄'} ${escape(hint.text)}</li>`).join('')}</ul>` : ''
}
function canFit(battle, id, position) {
  return rules.place(structuredClone(battle), id, position)
}
export function view(kit, state) {
  const journey = state.journey
  const battle = journey.battle
  const locked = state.queue.length > 0
  const hits = damageFeedback(state.step)
  // A duel fight shows both builds on one board: Player 1's grid, a gap column, then Player 2's grid.
  const isDuelFight = Boolean(journey.duel) && journey.duel.stage !== 'draft'
  const columns = journey.duel ? journey.duel.rules.columns : battle.grid.columns
  const boardColumns = isDuelFight ? columns * 2 + 1 : columns
  const shiftOf = id => isDuelFight && battle.items[id].owner === 'enemy' ? columns + 1 : 0
  const planning = !locked && journey.phase === 'battle' && battle.phase === 'planning'
  const preview = planning && state.selected ? connectionPreview(battle, state.selected) : null
  const order = planning ? preview?.order ?? activationOrder(battle) : {}
  const cells = Array.from({ length: (isDuelFight ? 2 : 1) * columns * battle.grid.rows }, (_, index) => {
    const cell = index % (columns * battle.grid.rows), side = Math.floor(index / (columns * battle.grid.rows))
    const position = [cell % columns, Math.floor(cell / columns)]
    const fits = state.moving && canFit(battle, state.selected, position)
    return kit.button(`${cell + 1}${state.moving ? fits ? ' ✓' : ' ×' : ''}`, { action: 'cell', value: index, class: `grid-cell ${state.moving ? fits ? 'valid' : 'invalid' : ''}`, style: `grid-column:${position[0] + 1 + side * (columns + 1)};grid-row:${position[1] + 1}` })
  })
  const sideLabels = isDuelFight ? `<div class="duel-side-label" style="grid-column:1/span ${columns}">P1</div><div class="duel-side-label rival" style="grid-column:${columns + 2}/span ${columns}">P2</div>` : ''
  const ready = journey.descent ? readyIds(journey) : new Set()
  const shapes = Object.values(battle.items).filter(item => item.position && !itemDefinition(battle, item.id).storage).map(item => {
    const definition = itemDefinition(battle, item.id)
    const connected = preview?.links.filter(link => [link.source, link.target].includes(item.id)) ?? []
    const isLate = connected.some(link => link.kind === 'late')
    const marker = planning ? `<span class="scan-marker" aria-label="${order[item.id] ? 'Normal turn ' + order[item.id] : 'Passive from cycle start'}">${order[item.id] ?? 'P'}</span>` : ''
    return `<div class="equipment-shape ${connected.length ? 'preview-linked' : ''} ${isLate ? 'preview-late' : ''} ${item.id === state.selected ? 'selected' : ''} ${state.link && [state.link, state.selected].includes(item.id) ? 'linked' : ''} ${item.id === state.step?.source?.id ? 'source item-attack' : ''} ${item.id === state.step?.target?.id ? 'target' : ''}" data-item="${item.id}" data-key="item:${item.id}:${item.id === state.step?.source?.id ? state.serial : 0}" style="grid-column:${item.position[0] + 1 + shiftOf(item.id)}/span ${definition.footprint[0]};grid-row:${item.position[1] + 1}/span ${definition.footprint[1]}">${marker}${familyEmblem(kit, definition)}${connected.length ? `<span class="connection-marker">${isLate ? '!' : '↔'}</span>` : ''}${art(kit, item.type, definition.name)}<small>${escape(definition.name)}</small>${journey.descent ? levelBadge(journey, item.id, ready) : ''}${glanceLines(battle, item.id)}${item.id === state.step?.source?.id && state.step.kind === 'ability' ? `<span class="fired">${escape(firedGlance(state.step))}</span>` : ''}${equipmentFeedback(item)}</div>`
  })
  const badges = edgeBadges(battle, connectionLinks(battle).links).map(badge => `<div class="edge-anchor" style="grid-column:${badge.cell[0] + 1 + shiftOf(badge.source)};grid-row:${badge.cell[1] + 1}"><span class="edge-badge edge-${badge.side} ${badge.kinds.map(kind => 'link-' + kind).join(' ')}">${badge.labels.map(escape).join('<br>')}</span></div>`)
  const packs = Object.values(battle.items).filter(item => item.position && itemDefinition(battle, item.id).storage)
  const regions = packs.map(item => `<div class="pack-region ${state.selected === item.id ? 'selected' : ''}" style="grid-column:${item.position[0] + 1}/span ${itemDefinition(battle, item.id).storage.columns};grid-row:1/span 3"><small>${escape(itemDefinition(battle, item.id).name)}</small></div>`).join('')
  const hasReservePack = planning && state.moving && state.selected && !battle.items[state.selected].position && !!itemDefinition(battle, state.selected).storage
  const socket = hasReservePack ? kit.button('＋\nPACK', { action: 'snap', class: 'pack-socket valid', label: 'Attach selected pack to right edge' }) : ''
  const reserve = Object.values(battle.items).filter(item => !item.position || itemDefinition(battle, item.id).storage).map(item => {
    const definition = itemDefinition(battle, item.id)
    return `<div class="reserve-art">${familyEmblem(kit, definition)}${art(kit, item.type, definition.name)}${kit.button(`${definition.name}\n${definition.storage ? item.position ? 'ATTACHED' : definition.storage.columns + '×3 container' : definition.footprint.join('×')}`, { action: 'select', value: item.id, class: 'item-choice' })}</div>`
  })
  const actor = id => {
    const actor = battle.actors[id]
    const statuses = Object.entries(actor.statuses).map(([id, status]) => `${rules.catalog.statuses[id].name} ${status.stacks}`).join(' · ') || 'No statuses'
    const hit = hits.find(hit => hit.id === id)
    const source = state.step?.source
    const attacking = hits.length && !state.step.statusId && (source?.kind === 'actor' ? source.id === id : battle.items[source?.id]?.owner === id)
    return `<div class="fighter ${id} ${hit ? 'damage-victim' : ''} ${attacking ? 'damage-attacker' : ''}" data-key="actor:${id}:${hit ? state.serial : 0}"><div class="actor-status"><b class="actor-role">${id === 'recruit' ? 'YOU' : 'ENEMY'}${hit ? hit.amount ? ' · HIT' : ' · BLOCK' : attacking ? ' · ATTACKING' : ''}</b><small>${escape(actor.name.toUpperCase())} · ${actor.health}/${actor.maxHealth}</small>${kit.bar(actor.health, { max: actor.maxHealth, trail: false })}<small>Guard ${actor.guard} · ${escape(statuses)}${id === 'enemy' ? ` · Attack ${rules.stat(battle, { kind: 'actor', id }, 'damage')}` : ` · Hunger ${actor.resources.hunger} · Salvage ${actor.resources.salvage ?? 0}`}</small></div><div class="actor-portrait">${art(kit, portraitOf(journey, id, actor), actor.name)}<div class="actor-token ${hit && !hit.amount ? 'blocked-token' : ''}">${hit ? hit.amount ? `−${hit.amount}` : 'BLOCK' : ''}</div></div></div>`
  }
  const phase = journey.phase === 'expeditionComplete' ? 'EXPEDITION COMPLETE' : journey.phase === 'practiceComplete' ? 'TEST COMPLETE' : journey.phase === 'defeat' ? 'DEFEAT' : locked ? state.paused || state.expanded ? 'HELD' : 'RESOLVING' : 'ARRANGE'
  const stageContent = journey.descent ? battleStage(kit, state, descentCast(state)) : journey.duel ? (journey.duel.stage === 'draft' ? duelDraftStage(kit, state) : battleStage(kit, state, duelCast(state))) : null
  const stage = stageContent !== null ? kit.target(stageContent, { action: 'deselect', as: 'section', attributes: { class: 'stage battle-stage' } }) : kit.target(`${actor('recruit')}${actor('enemy')}${stageFeedback(state)}<div class="event-caption ${hits.length ? 'impact-caption' : ''}" role="status"><strong>${phase}</strong><span>${escape([state.message || journey.message, planning ? battle.actors.enemy.intent : '', state.saveWarning].filter(Boolean).join(' '))}</span></div>`, { action: 'deselect', as: 'section', attributes: { class: `stage ${hits.length ? 'has-damage' : ''}` } })
  const primary = !locked && journey.duel ? duelPrimary(journey) : locked ? { text: state.paused ? 'RESUME' : 'PAUSE', action: 'pause' } : journey.phase === 'expeditionComplete' || (journey.phase === 'defeat' && journey.expedition) ? { text: 'RETURN TO TAVERN', action: 'returnTavern' } : ['defeat', 'practiceComplete'].includes(journey.phase) ? { text: journey.sandbox ? 'RESET TEST' : 'RETRY ROOM', action: 'retry' } : { text: journey.sandbox && battle.cycle > 1 ? 'NEXT CYCLE' : 'FIGHT', action: 'fight' }
  const families = Object.entries(familyKits).map(([id, family]) => kit.button(family.name, { action: 'family', value: id, isDisabled: locked && !journey.sandbox })).join('')
  const menu = `<div class="menu-shade"><section class="pause-sheet"><h2>${journey.sandbox ? 'Family Lab' : 'Paused'}</h2>${kit.button('Continue', { action: 'menu' })}${journey.duel ? kit.button('Leave the Duel Pit', { action: 'leaveDuel' }) : journey.descent ? kit.button('Give up this run', { action: 'abandon' }) : kit.button(journey.sandbox ? 'Leave practice' : 'Abandon expedition & return', { action: 'reset' })}${journey.expedition ? '<p>Abandoning loses unbanked finds and causes an injury. Your departure kit is recovered.</p>' : ''}${journey.descent ? '<p>Fight a floor. Embers fill the bar; a full bar is a level and a card. Elites and bosses drop chests. An item at level 5 touching its partner evolves at the next chest.</p>' : ''}<p>Fight → salvage → descend. An item find every fourth room. Storage items alone expand your grid. Auto continues cycles within a room. Full Details holds combat.</p><p>Left-to-right, top-to-bottom scan. Edge neighbours link; diagonal cells do not. Unused preparation expires at cycle end.</p><h3>FAMILY LAB · PICK A KIT</h3>${families}<p>Switching kits resets the test. Every item is in reserve; mix freely.</p>${journey.sandbox ? kit.button('Return to dungeon', { action: 'leaveLab' }) : ''}${kit.button("Scribe’s Bench · craft concepts", { action: 'openCrafter', isDisabled: locked })}${kit.button('History', { action: 'history' })}</section></div>`
  const history = `<div class="menu-shade"><section class="pause-sheet">${kit.button('Close history', { action: 'history' })}<ol>${state.log.map(line => `<li>${escape(line)}</li>`).join('') || '<li>No actions yet.</li>'}</ol></section></div>`
  const overlay = state.menu ? menu : state.history ? history : journey.duel ? duelOverlay(kit, journey, state) : journey.descent ? runOverlay(kit, journey, state) : journey.phase === 'reward' ? rewardOverlay(kit, journey) : ''
  return `<main class="bell-game ${journey.descent || journey.duel ? 'descent-run' : ''} ${journey.duel?.stage === 'draft' ? 'duel-drafting' : ''} ${state.selected ? 'inspecting' : ''} ${state.expanded ? 'expanded-inspection' : ''}" style="--columns:${columns};--board-columns:${boardColumns};--visible-columns:${Math.min(boardColumns + (hasReservePack ? 1 : 0), isDuelFight ? boardColumns : 5)}"><header>${journey.duel ? duelHeader(kit, journey) : journey.descent ? runHeader(kit, journey) : `<span>BLACK BELL · TAVERN-01 · ${journey.sandbox ? 'LAB · ' + familyKits[journey.sandbox].name : 'ROOM ' + journey.room} · CYCLE ${battle.cycle}${journey.sandbox ? ' · PRACTICE' : ` · SCRAP ${journey.scrap} · FIND ${Math.ceil(journey.room / findInterval) * findInterval}`}</span>`}<div>${journey.expedition ? kit.button('Return to tavern', { action: 'returnTavern', isDisabled: locked || (journey.phase === 'battle' && battle.started) }) : ''}${journey.sandbox ? kit.button('Reset test', { action: 'practiceReset' }) : journey.expedition || journey.descent || journey.duel ? '' : kit.button('Family Lab', { action: 'menu' })}${kit.button('History', { action: 'history' })}${kit.button('Menu', { action: 'menu' })}</div></header>${stage}<section class="dock"><aside class="reserve"><small>${isDuelFight ? 'BUILDS' : journey.duel ? `SHELF · ${Object.keys(battle.items).length} ITEMS` : `RESERVE · ${Object.keys(battle.items).length} OWNED`}</small><div class="reserve-items">${reserve.join('') || (isDuelFight ? '<p>Both builds are locked in. P1 is the left grid, P2 the right.</p>' : journey.descent ? '<p>All gear is on the grid.</p>' : '<p>Keep your kit. Item finds every 4 rooms.</p>')}</div>${journey.duel ? isDuelFight ? '' : `<small>The shelf · up to ${journey.duel.rules.items} items · tap one, then a cell</small>` : journey.descent ? `${evolveList(journey)}<small>New gear comes from level-up cards · tap to equip</small>` : journey.sandbox ? '<small>All test items available · tap to equip</small>' : kit.button(`Search cache · ${cacheCost} scrap`, { action: 'cache', isDisabled: locked || journey.phase !== 'battle' || journey.scrap < cacheCost })}</aside><section class="loadout"><div class="grid-title">EQUIPMENT <span>${state.moving ? 'PLACE ITEM' : planning ? '# TURN · P' : `${columns}×3 · SCAN →`}</span></div><div class="loadout-body"><div class="board-scroll"><div class="board ${isDuelFight ? 'duel-board' : ''}">${sideLabels}${cells.join('')}${regions}${shapes.join('')}${badges.join('')}</div></div>${socket}</div></section><aside class="bell-controls">${kit.button(primary.text, { action: primary.action, class: 'bell-button', kind: 'primary' })}${kit.button('Step', { action: 'step', isDisabled: !locked || !state.paused })}${kit.toggle('Auto', { action: 'auto', isOn: state.auto })}${kit.toggle('Slow', { action: 'slow', isOn: state.speed === 'slow' })}${kit.toggle('Fast', { action: 'fast', isOn: state.speed === 'fast' })}</aside></section>${tooltip(kit, state)}${overlay}</main>`
}
