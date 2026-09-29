/**
 * Game UI base CSS: the kit's own rules, written against `--ui-*` tokens only.
 *
 * A game's theme overrides tokens first and rules second. Nothing here names a
 * colour: a rule that did could not be themed.
 */
export const BASE_CSS = `
:host { font: var(--ui-size) / 1.35 var(--ui-font); color: var(--ui-ink); }
* { box-sizing: border-box; scrollbar-width: thin; scrollbar-color: var(--ui-edge) transparent; }
[data-ui-control], .ui-panel, .ui-tip { pointer-events: auto; }
[data-focus] { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
[data-disabled] { opacity: 0.4; pointer-events: none; }
[hidden] { display: none !important; }
.ui-anchor { position: absolute; left: 0; top: 0; transform-origin: 0 0; will-change: transform; contain: layout style; pointer-events: none; }
.ui-anchor[data-interactive] { pointer-events: auto; }

.ui-stack, .ui-row, .ui-grid { display: flex; flex-direction: column; gap: calc(var(--ui-space) * var(--gap, 1)); }
.ui-row { flex-direction: row; align-items: center; flex-wrap: wrap; }
.ui-grid { display: grid; grid-template-columns: repeat(var(--columns, 3), minmax(0, 1fr)); }
.ui-stack[data-align="center"], .ui-row[data-align="center"] { align-items: center; }
.ui-stack[data-align="end"], .ui-row[data-align="end"] { align-items: flex-end; }
.ui-stack > .ui-button, .ui-stack > .ui-toggle, .ui-stack > .ui-badge { align-self: flex-start; }
.ui-scroll { overflow: auto; max-height: var(--height, 240px); }
.ui-spacer { flex: 1; min-width: calc(var(--ui-space) * var(--size, 1)); min-height: calc(var(--ui-space) * var(--size, 1)); }
.ui-divider { border: 0; border-top: 1px solid var(--ui-edge); width: 100%; margin: 0; }

.ui-panel { background: var(--ui-surface); border: 1px solid var(--ui-edge); border-radius: var(--ui-radius); padding: calc(var(--ui-space) * 2); display: flex; flex-direction: column; gap: var(--ui-space); }
.ui-panel-title, .ui-heading { margin: 0; font-weight: 700; }
.ui-heading[data-level="1"] { font-size: 1.75em; }
.ui-heading[data-level="2"] { font-size: 1.35em; }
.ui-heading[data-level="3"] { font-size: 1.1em; }
.ui-text { margin: 0; }
[data-tone="quiet"] { color: var(--ui-quiet); }
[data-tone="accent"] { color: var(--ui-accent); }
[data-tone="good"] { color: var(--ui-good); }
[data-tone="danger"] { color: var(--ui-danger); }
.ui-icon { display: inline-block; min-width: 1.2em; text-align: center; }
.ui-portrait { width: var(--size, 64px); height: var(--size, 64px); object-fit: cover; border-radius: var(--ui-radius); border: 1px solid var(--ui-edge); }
.ui-key { display: inline-flex; align-items: center; gap: var(--ui-space); color: var(--ui-quiet); }
.ui-key kbd { font: inherit; padding: 0 calc(var(--ui-space) * 0.75); border: 1px solid var(--ui-edge); border-bottom-width: 3px; border-radius: calc(var(--ui-radius) * 0.5); color: var(--ui-ink); background: var(--ui-track); }

.ui-button { font: inherit; color: var(--ui-ink); background: var(--ui-track); border: 1px solid var(--ui-edge); border-radius: var(--ui-radius); padding: var(--ui-space) calc(var(--ui-space) * 2); cursor: pointer; display: inline-flex; gap: var(--ui-space); align-items: center; justify-content: center; }
.ui-button:hover { border-color: var(--ui-accent); }
.ui-button:active { transform: translateY(1px); }
.ui-button[data-kind="primary"] { background: var(--ui-accent); color: var(--ui-on-accent); border-color: var(--ui-accent); font-weight: 700; }
.ui-button[data-kind="danger"] { border-color: var(--ui-danger); color: var(--ui-danger); }
.ui-button[data-kind="quiet"] { background: transparent; border-color: transparent; color: var(--ui-quiet); }
.ui-field { display: flex; flex-direction: column; gap: calc(var(--ui-space) * 0.5); }
.ui-field-label { color: var(--ui-quiet); font-size: 0.85em; }
.ui-field-row { display: flex; align-items: center; gap: var(--ui-space); }
.ui-input, .ui-select { font: inherit; color: var(--ui-ink); background: var(--ui-track); border: 1px solid var(--ui-edge); border-radius: calc(var(--ui-radius) * 0.6); padding: calc(var(--ui-space) * 0.75) var(--ui-space); min-width: 8em; }
.ui-input:focus { outline: 2px solid var(--ui-accent); }
.ui-slider { accent-color: var(--ui-accent); min-width: 10em; }
.ui-toggle { display: inline-flex; align-items: center; gap: var(--ui-space); cursor: pointer; }
.ui-toggle input { accent-color: var(--ui-accent); width: 1.1em; height: 1.1em; }
.ui-tabs { display: flex; flex-wrap: wrap; gap: calc(var(--ui-space) * 0.5); border-bottom: 1px solid var(--ui-edge); }
.ui-tab { font: inherit; color: var(--ui-quiet); background: transparent; border: 0; border-bottom: 2px solid transparent; padding: var(--ui-space) calc(var(--ui-space) * 1.5); cursor: pointer; }
.ui-tab[data-selected] { color: var(--ui-ink); border-bottom-color: var(--ui-accent); }

.ui-bar { display: flex; flex-direction: column; gap: calc(var(--ui-space) * 0.5); min-width: 8em; }
.ui-bar-head { display: flex; justify-content: space-between; font-size: 0.85em; color: var(--ui-quiet); }
.ui-bar-track { height: 0.8em; background: var(--ui-track); border-radius: 999px; overflow: hidden; }
.ui-bar-fill { height: 100%; width: calc(var(--fraction, 0) * 100%); background: var(--ui-accent); border-radius: inherit; }
.ui-bar[data-kind="health"] .ui-bar-fill { background: var(--ui-danger); }
.ui-bar[data-kind="good"] .ui-bar-fill { background: var(--ui-good); }
.ui-slot { position: relative; width: 4em; height: 4em; display: flex; align-items: center; justify-content: center; font: inherit; color: var(--ui-ink); background: var(--ui-track); border: 1px solid var(--ui-edge); border-radius: var(--ui-radius); cursor: pointer; padding: 0; }
.ui-slot[data-selected] { border-color: var(--ui-accent); }
.ui-slot-glyph { font-size: 1.6em; }
.ui-slot-count { position: absolute; right: 0.3em; bottom: 0.1em; font-size: 0.8em; }
.ui-badge { display: inline-block; padding: 0 calc(var(--ui-space) * 1); border-radius: 999px; background: var(--ui-track); border: 1px solid var(--ui-edge); font-size: 0.8em; }
.ui-badge[data-tone="accent"] { background: var(--ui-accent); color: var(--ui-on-accent); }
.ui-list { display: flex; flex-direction: column; border: 1px solid var(--ui-edge); border-radius: var(--ui-radius); overflow: hidden; }
.ui-row-item { display: flex; justify-content: space-between; gap: var(--ui-space); font: inherit; color: var(--ui-ink); background: transparent; border: 0; border-bottom: 1px solid var(--ui-edge); padding: var(--ui-space) calc(var(--ui-space) * 1.5); text-align: left; cursor: pointer; }
.ui-row-item:last-child { border-bottom: 0; }
.ui-row-item[data-selected] { background: var(--ui-track); }
.ui-tip { position: relative; display: inline-block; }
.ui-tip-body { position: absolute; bottom: 100%; left: 0; margin-bottom: var(--ui-space); white-space: nowrap; display: none; background: var(--ui-surface); border: 1px solid var(--ui-edge); border-radius: calc(var(--ui-radius) * 0.6); padding: calc(var(--ui-space) * 0.5) var(--ui-space); }
.ui-tip:hover .ui-tip-body { display: block; }
.ui-modal-scrim { position: absolute; inset: 0; background: var(--ui-scrim); display: flex; align-items: center; justify-content: center; pointer-events: auto; }
.ui-modal { min-width: 20em; max-width: 90%; }
.ui-toast { display: inline-block; background: var(--ui-surface); border: 1px solid var(--ui-edge); border-left: 4px solid var(--ui-accent); border-radius: calc(var(--ui-radius) * 0.6); padding: var(--ui-space) calc(var(--ui-space) * 2); }
.ui-toast[data-tone="good"] { border-left-color: var(--ui-good); }
.ui-toast[data-tone="danger"] { border-left-color: var(--ui-danger); }
`
