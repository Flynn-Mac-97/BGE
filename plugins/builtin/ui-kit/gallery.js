/**
 * UI Kit gallery: every entry drawn at once, grouped, as HTML for one
 * sandbox. A tile's name and stage carry `data-pick` with the entry's id, so a
 * click or Enter picks it. The chrome is its own `kit-` classes, after the
 * game's sheet, and styles nothing the game draws.
 */
import { escapeHtml } from '../game-ui/components.js'
import { GROUP_ORDER, defaultsOf } from './catalogue.js'

/** The chrome around the tiles. `--kit-backdrop` is what the game UI is drawn over. */
export const GALLERY_CSS = `
.kit-gallery { display: grid; gap: 18px; padding: 14px 16px; min-height: 100%; box-sizing: border-box; background: var(--kit-backdrop, #0b0d10); }
.kit-group-title { margin: 0 0 8px; display: flex; align-items: center; gap: 10px; font: 600 11px/1 var(--ui-font); letter-spacing: 0.18em; text-transform: uppercase; color: var(--ui-quiet); }
.kit-group-title::after { content: ''; flex: 1; height: 1px; background: var(--ui-edge); }
.kit-group-count { opacity: 0.6; }
/* Packed: each element at its own size, wrapped in rows, with no box around it. */
.kit-tiles { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 14px 18px; }
.kit-tile { display: flex; flex-direction: column; gap: 4px; padding: 4px; outline: 1px solid transparent; }
.kit-tile[data-selected] { outline-color: var(--ui-accent); }
.kit-tile-name { all: unset; cursor: pointer; font: 10px/1.2 var(--ui-font); letter-spacing: 0.1em; text-transform: uppercase; color: var(--ui-quiet); opacity: 0.7; }
.kit-tile:hover .kit-tile-name, .kit-tile[data-selected] .kit-tile-name { opacity: 1; color: var(--ui-ink); }
.kit-tile-name:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
.kit-tile-stage { cursor: pointer; }
.kit-empty { color: var(--ui-quiet); font: 13px var(--ui-font); }
`

/** One entry: a small pick button with its name over the entry drawn with its values. */
function tileHtml(entry, values, isSelected) {
  const id = escapeHtml(entry.id)
  return `<section class="kit-tile"${isSelected ? ' data-selected' : ''}>`
    + `<button type="button" class="kit-tile-name" data-pick="${id}" aria-pressed="${isSelected}">${escapeHtml(entry.title)}</button>`
    + `<div class="kit-tile-stage" data-pick="${id}">${entry.render(values)}</div></section>`
}

/**
 * The gallery's HTML. `valuesOf(entry)` is the prop values a tile is drawn
 * with; `selectedId` marks one tile. Groups with no entries are left out.
 */
export function galleryHtml(entries, { valuesOf = defaultsOf, selectedId } = {}) {
  if (!entries.length) return '<div class="kit-gallery"><p class="kit-empty">Nothing matches.</p></div>'
  const groups = GROUP_ORDER.map(group => [group, entries.filter(entry => entry.group === group)]).filter(([, members]) => members.length)
  return '<div class="kit-gallery">' + groups.map(([group, members]) =>
    `<section class="kit-group" aria-label="${escapeHtml(group)}"><h2 class="kit-group-title">${escapeHtml(group)} <span class="kit-group-count">${members.length}</span></h2>`
    + `<div class="kit-tiles">${members.map(entry => tileHtml(entry, valuesOf(entry), entry.id === selectedId)).join('')}</div></section>`).join('') + '</div>'
}
