/** A landscape game field keeps the battle above inventory, with loot shown as a game overlay. */
import { rules, itemDefinition } from './rules.js'
import { tooltip } from './tooltip.js'
import { equipmentFeedback, stageFeedback } from './feedback.js'
import { escape } from './inspection.js'

function rewardOverlay(kit, journey) {
  return `<div class="menu-shade"><section class="loot-sheet"><h2>${journey.rewardKind === 'room' ? 'VICTORY · CHOOSE YOUR FIND' : 'SCAVENGED CACHE'}</h2><p>${escape(journey.message)}</p><div class="loot-choices">${journey.choices.map(type => {
    const item = rules.catalog.items[type]
    return `<section class="loot-card"><b>${escape(item.mark)}</b><strong>${escape(item.name)}</strong><small>${item.footprint.join('×')} slots</small><p>${escape(item.description)}</p>${kit.button('Keep ' + item.name, { action: 'claim', value: type })}</section>`
  }).join('')}</div></section></div>`
}
function canFit(battle, id, position) {
  return rules.place(structuredClone(battle), id, position)
}
export function view(kit, state) {
  const journey = state.journey
  const battle = journey.battle
  const locked = state.queue.length > 0
  const columns = battle.grid.columns
  const cells = Array.from({ length: columns * battle.grid.rows }, (_, cell) => {
    const position = [cell % columns, Math.floor(cell / columns)]
    const fits = state.moving && canFit(battle, state.selected, position)
    return kit.button(`${cell + 1}${state.moving ? fits ? ' ✓' : ' ×' : ''}`, { action: 'cell', value: cell, class: `grid-cell ${state.moving ? fits ? 'valid' : 'invalid' : ''}`, style: `grid-column:${position[0] + 1};grid-row:${position[1] + 1}` })
  })
  const shapes = Object.values(battle.items).filter(item => item.position).map(item => {
    const definition = itemDefinition(battle, item.id)
    return `<div class="equipment-shape ${item.id === state.selected ? 'selected' : ''} ${state.link && [state.link, state.selected].includes(item.id) ? 'linked' : ''} ${item.id === state.step?.source?.id ? 'source item-attack' : ''} ${item.id === state.step?.target?.id ? 'target' : ''}" data-item="${item.id}" style="grid-column:${item.position[0] + 1}/span ${definition.footprint[0]};grid-row:${item.position[1] + 1}/span ${definition.footprint[1]}"><b>${escape(definition.mark)}</b><small>${escape(definition.name)}</small>${equipmentFeedback(item)}</div>`
  })
  const reserve = Object.values(battle.items).filter(item => !item.position).map(item => {
    const definition = itemDefinition(battle, item.id)
    return kit.button(`${definition.mark} · ${definition.name}\n${definition.footprint.join('×')}`, { action: 'select', value: item.id, class: 'item-choice' })
  })
  const actor = (id, mark) => {
    const actor = battle.actors[id]
    const poison = actor.statuses.poison?.stacks ?? 0
    return `<div class="fighter ${id}"><div class="actor-status"><small>${escape(actor.name.toUpperCase())} · ${actor.health}/${actor.maxHealth}</small>${kit.bar(actor.health, { max: actor.maxHealth, trail: false })}<small>Guard ${actor.guard} · Poison ${poison}${id === 'enemy' ? ` · Attack ${actor.stats.damage}` : ` · Hunger ${actor.resources.hunger}`}</small></div><div class="actor-token">${mark}</div></div>`
  }
  const phase = journey.phase === 'defeat' ? 'DEFEAT' : locked ? state.paused || state.expanded ? 'HELD' : 'RESOLVING' : 'ARRANGE'
  const stage = kit.target(`${actor('recruit', 'R')}${actor('enemy', battle.actors.enemy.mark)}${stageFeedback(state)}<div class="event-caption" role="status"><strong>${phase}</strong><span>${escape(state.message || journey.message)}</span></div>`, { action: 'deselect', as: 'section', attributes: { class: 'stage' } })
  const primary = locked ? { text: state.paused ? 'RESUME' : 'PAUSE', action: 'pause' } : journey.phase === 'defeat' ? { text: 'RETRY ROOM', action: 'retry' } : { text: 'FIGHT', action: 'fight' }
  const menu = `<div class="menu-shade"><section class="pause-sheet"><h2>Paused</h2>${kit.button('Continue', { action: 'menu' })}${kit.button('New run', { action: 'reset' })}<p>Fight → choose a find → equip → descend. Auto continues cycles within a room. Each room pauses for loot. Full Details holds combat.</p><p>Left-to-right, top-to-bottom scan. Edge neighbours link; diagonal cells do not. Unused preparation expires at cycle end.</p>${kit.button('History', { action: 'history' })}</section></div>`
  const history = `<div class="menu-shade"><section class="pause-sheet">${kit.button('Close history', { action: 'history' })}<ol>${state.log.map(line => `<li>${escape(line)}</li>`).join('') || '<li>No actions yet.</li>'}</ol></section></div>`
  const overlay = state.menu ? menu : state.history ? history : journey.phase === 'reward' ? rewardOverlay(kit, journey) : ''
  return `<main class="bell-game ${state.selected ? 'inspecting' : ''} ${state.expanded ? 'expanded-inspection' : ''}" style="--columns:${columns}"><header><span>BLACK BELL · ROOM ${journey.room} · CYCLE ${battle.cycle} · SCRAP ${journey.scrap}</span><div>${kit.button('History', { action: 'history' })}${kit.button('Menu', { action: 'menu' })}</div></header>${stage}<section class="dock"><aside class="reserve"><small>RESERVE · ${Object.keys(battle.items).length} OWNED</small><div class="reserve-items">${reserve.join('') || '<p>Win a room to find equipment.</p>'}</div>${kit.button('Search cache · 3 scrap', { action: 'cache', isDisabled: locked || journey.phase !== 'battle' || journey.scrap < 3 })}</aside><section class="loadout"><div class="grid-title">EQUIPMENT <span>${state.moving ? 'PLACE ITEM' : `${columns}×3 · SCAN →`}</span></div><div class="board">${cells.join('')}${shapes.join('')}</div></section><aside class="bell-controls">${kit.button(primary.text, { action: primary.action, class: 'bell-button', kind: 'primary' })}${kit.button('Step', { action: 'step', isDisabled: !locked || !state.paused })}${kit.toggle('Auto', { action: 'auto', isOn: state.auto })}${kit.toggle('Slow', { action: 'slow', isOn: state.slow })}</aside></section>${tooltip(kit, state)}${overlay}</main>`
}
