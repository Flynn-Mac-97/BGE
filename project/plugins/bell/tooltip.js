/** Compact current values stay readable; full rule details hold the battle presentation. */
import { art } from './art.js'
import { familyEmblem } from './power-families.js'
import { connectionPreview } from './connections.js'
import { itemDefinition } from './rules.js'
import { inspectItem, escape } from './inspection.js'
import { chargesLeft } from './descent/run.js'
export function tooltip(kit, state) {
  if (!state.selected) return '<div class="inspection-hint">Tap an item to inspect. Equip → tap a cell. Scan: left to right, top to bottom.</div>'
  const reading = inspectItem(state.journey.battle, state.selected)
  const disabled = state.queue.length > 0 || state.journey.phase !== 'battle'
  const button = (text, action, options = {}) => kit.button(text, { action, ...options })
  const { definition } = reading
  const planning = !disabled && state.journey.battle.phase === 'planning'
  const preview = planning ? connectionPreview(state.journey.battle, state.selected) : null
  const connections = preview ? `<section><h3>PLACEMENT PREVIEW · NORMAL SCAN</h3>${preview.warnings.map(warning => `<p class="connection-warning">! ${escape(warning)}</p>`).join('')}${preview.links.map(link => button(`${itemDefinition(state.journey.battle, link.source).name} → ${itemDefinition(state.journey.battle, link.target).name} · ${link.text}`, 'link', { value: link.source === state.selected ? link.target : link.source, class: 'source-link' })).join('') || `<p>${reading.item.position ? 'No item connections in this arrangement.' : 'Equip this item to preview its connections.'}</p>`}<p>Numbers mark normal item turns. P marks passive listeners and auras. Extra actions can change when an item acts.</p></section>` : ''
  const details = state.expanded ? `<div class="tooltip-details"><section><h3>RULE</h3><p>${escape(definition.description)}</p></section>${connections}<section><h3>ACTIVE EFFECTS</h3><p>${escape(reading.bonuses.join(' · ') || 'None applied.')}</p><p>Next-action preparation expires at cycle end if unused.</p></section><section><h3>TRIGGERS & LIMITS</h3>${reading.abilities.map(ability => `<p>${escape(ability)}</p>`).join('')}</section>${planning ? '' : `<section><h3>GRID LINKS</h3>${reading.links.map(link => button(link.name, 'link', { value: link.id, class: 'source-link' })).join('') || '<p>No linked items.</p>'}</section>`}</div>` : ''
  const baseSummary = reading.damage === null ? definition.description : `${reading.damage} damage${reading.poison ? ` + ${reading.poison} Poison ready` : ''}. ${reading.bonuses.join(' · ') || 'No preparation applied yet.'}`
  const firstLink = preview?.links[0]
  const hint = preview?.warnings[0] ?? (firstLink ? `${itemDefinition(state.journey.battle, firstLink.source).name} → ${itemDefinition(state.journey.battle, firstLink.target).name} · ${firstLink.kind === 'reaction' ? 'conditional reaction' : firstLink.kind === 'aura' ? 'while adjacent' : 'linked'}` : null)
  const summary = hint ? `${preview.warnings.length ? '! ' : 'Preview: '}${hint}` : baseSummary
  return `<section class="inspection ${state.expanded ? 'full' : 'compact'}" aria-label="Item tooltip"><div class="tooltip-header">${art(kit, reading.item.type, definition.name)}<div><strong>${escape(definition.name)}${familyEmblem(kit, definition)}</strong><small>${definition.storage ? definition.storage.columns + '×3 container' : definition.footprint.join('×') + ' slots'} · ${reading.status}</small></div>${button('×', 'deselect', { class: 'tooltip-close', label: 'Close item tooltip' })}</div><p class="tooltip-summary">${escape(summary)}</p>${details}<div class="tooltip-actions">${useButton(kit, state)}${button(state.expanded ? 'Less' : 'Details', 'details')}${definition.storage ? reading.item.position ? '' : button('Attach right', 'snap', { value: state.selected, isDisabled: disabled }) : button(state.moving ? 'Cancel' : reading.item.position ? 'Move' : 'Equip', 'move', { isDisabled: disabled })}${button(definition.storage ? 'Detach' : 'Stow', 'remove', { isDisabled: disabled || !reading.item.position })}${state.journey.sandbox || state.journey.duel ? '' : button('Salvage', 'salvage', { isDisabled: disabled })}</div></section>`
}

/** The Use button for a Descent consumable: works while the fight plays, since a tap only readies it. */
function useButton(kit, state) {
  const item = state.journey.descent?.items[state.selected]
  const left = item ? chargesLeft(item) : null
  if (left === null) return ''
  const label = item.readied ? 'Readied · next cycle' : `Use · ${left} left`
  return kit.button(label, { action: 'useItem', value: state.selected, kind: 'primary', isDisabled: item.readied || !left || state.journey.phase !== 'battle' || !state.journey.battle.items[state.selected].position })
}
