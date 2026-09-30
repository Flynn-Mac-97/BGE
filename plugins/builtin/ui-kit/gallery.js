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
.kit-gallery { display: grid; gap: 22px; padding: 16px; min-height: 100%; box-sizing: border-box; background: var(--kit-backdrop, #0b0d10); }
.kit-group-title { margin: 0 0 10px; display: flex; align-items: center; gap: 10px; font: 600 11px/1 var(--ui-font); letter-spacing: 0.18em; text-transform: uppercase; color: var(--ui-quiet); }
.kit-group-title::after { content: ''; flex: 1; height: 1px; background: var(--ui-edge); }
.kit-group-count { opacity: 0.6; }
/* Flex, not a grid: a tile grows to fit a wide component instead of clipping it. */
.kit-tiles { display: flex; flex-wrap: wrap; gap: 10px; }
.kit-tile { flex: 1 1 220px; }
.kit-tile { display: grid; grid-template-rows: auto 1fr; min-height: 118px; border: 1px solid var(--ui-edge); background-color: rgba(127, 127, 127, 0.04); background-image: conic-gradient(rgba(127, 127, 127, 0.07) 25%, transparent 0 50%, rgba(127, 127, 127, 0.07) 0 75%, transparent 0); background-size: 14px 14px; }
.kit-tile[data-selected] { border-color: var(--ui-accent); box-shadow: 0 0 0 1px var(--ui-accent); }
.kit-tile-name { all: unset; box-sizing: border-box; display: flex; justify-content: space-between; gap: 8px; padding: 6px 10px; cursor: pointer; font: 600 11px/1.2 var(--ui-font); letter-spacing: 0.12em; text-transform: uppercase; color: var(--ui-quiet); border-bottom: 1px solid var(--ui-edge); background: rgba(127, 127, 127, 0.06); }
.kit-tile[data-selected] .kit-tile-name { color: var(--ui-ink); }
.kit-tile-name:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: -2px; }
.kit-tile-kind { opacity: 0.55; font-weight: 400; letter-spacing: 0.06em; text-transform: none; }
.kit-tile-stage { display: flex; align-items: center; justify-content: center; padding: 18px 14px; cursor: pointer; }
.kit-tile-stage > * { max-width: 100%; }
.kit-empty { color: var(--ui-quiet); font: 13px var(--ui-font); }
`

/** One tile: a pick button with the name, and the entry drawn with its values. */
function tileHtml(entry, values, isSelected) {
  const id = escapeHtml(entry.id)
  return `<section class="kit-tile"${isSelected ? ' data-selected' : ''}>`
    + `<button type="button" class="kit-tile-name" data-pick="${id}" aria-pressed="${isSelected}">${escapeHtml(entry.title)}<span class="kit-tile-kind">${entry.kind === 'game' ? 'file' : 'kit'}</span></button>`
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
