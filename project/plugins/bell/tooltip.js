/** Compact current values stay readable; full rule details hold the battle presentation. */
import { inspectItem, escape } from './inspection.js'
export function tooltip(kit, state) {
  if (!state.selected) return '<div class="inspection-hint">Tap an item to inspect. Equip → tap a cell. Scan: left to right, top to bottom.</div>'
  const reading = inspectItem(state.journey.battle, state.selected)
  const disabled = state.queue.length > 0 || state.journey.phase !== 'battle'
  const button = (text, action, options = {}) => kit.button(text, { action, ...options })
  const { definition } = reading
  const details = state.expanded ? `<div class="tooltip-details"><section><h3>RULE</h3><p>${escape(definition.description)}</p></section><section><h3>ACTIVE EFFECTS</h3><p>${escape(reading.bonuses.join(' · ') || 'None applied.')}</p><p>Next-action preparation expires at cycle end if unused.</p></section><section><h3>TRIGGERS & LIMITS</h3>${reading.abilities.map(ability => `<p>${escape(ability)}</p>`).join('')}</section><section><h3>GRID LINKS</h3>${reading.links.map(link => button(link.name, 'link', { value: link.id, class: 'source-link' })).join('') || '<p>No linked items.</p>'}</section></div>` : ''
  const summary = reading.damage === null ? definition.description : `${reading.damage} damage${reading.poison ? ` + ${reading.poison} Poison ready` : ''}. ${reading.bonuses.join(' · ') || 'No preparation applied yet.'}`
  return `<section class="inspection ${state.expanded ? 'full' : 'compact'}" aria-label="Item tooltip"><div class="tooltip-header"><span class="tooltip-mark">${escape(definition.mark)}</span><div><strong>${escape(definition.name)}</strong><small>${definition.footprint.join('×')} slots · ${reading.status}</small></div>${button('×', 'deselect', { class: 'tooltip-close', label: 'Close item tooltip' })}</div><p class="tooltip-summary">${escape(summary)}</p>${details}<div class="tooltip-actions">${button(state.expanded ? 'Less' : 'Details', 'details')}${button(state.moving ? 'Cancel' : reading.item.position ? 'Move' : 'Equip', 'move', { isDisabled: disabled })}${button('Stow', 'remove', { isDisabled: disabled || !reading.item.position })}${button('Salvage', 'salvage', { isDisabled: disabled })}</div></section>`
}
