/**
 * Game UI theme: the one stylesheet that styles every panel of a game.
 *
 * A game writes `assets/ui/theme.css`. Its `--ui-*` custom properties are the
 * design tokens; its rules can restyle any kit class (`.ui-button`). The same
 * tokens colour Screen and the HUD, so one file styles every surface.
 *
 * Panels are shadow roots, and a selector cannot cross a shadow boundary. So
 * the theme is one constructed stylesheet that every panel adopts, and `:root`
 * in the file is rewritten to `:host`, which is what `:root` means inside a
 * panel.
 */
import { BASE_CSS } from './base-css.js'

/** Token name → value. A token is `--ui-<name>` in CSS; Screen and the HUD read the colours. */
export const DEFAULT_TOKENS = {
  ink: '#ede8dc',
  quiet: 'rgba(237, 232, 220, 0.66)',
  surface: 'rgba(17, 19, 22, 0.94)',
  edge: 'rgba(237, 232, 220, 0.16)',
  accent: '#ff8a3d',
  'on-accent': '#16130f',
  track: 'rgba(237, 232, 220, 0.10)',
  scrim: 'rgba(8, 9, 11, 0.74)',
  outline: 'rgba(0, 0, 0, 0.8)',
  good: '#6ccb8a',
  danger: '#ff5a5f',
  trail: 'rgba(237, 232, 220, 0.55)',
  // DIN-style faces a player's system already has: Windows ships Bahnschrift, macOS DIN Alternate.
  font: "Bahnschrift, 'DIN Alternate', 'Barlow', 'Roboto Condensed', 'Segoe UI', system-ui, sans-serif",
  size: '15px',
  radius: '2px',
  space: '8px',
  duration: '0.16s',
  ease: 'cubic-bezier(0.2, 0.7, 0.1, 1)'
}

/** Screen's palette key → the token that colours it. */
const SCREEN_TOKENS = {
  ink: 'ink',
  dim: 'scrim',
  panel: 'surface',
  edge: 'edge',
  accent: 'accent',
  track: 'track',
  quiet: 'quiet'
}

const DECLARATION = /--ui-([a-z-]+)\s*:\s*([^;}]+)/g

/** Every token a stylesheet declares, over the defaults. */
export function tokensOf(css) {
  const declared = Object.fromEntries([...css.matchAll(DECLARATION)].map(([, name, value]) => [name, value.trim()]))
  return { ...DEFAULT_TOKENS, ...declared }
}

/** The stylesheet text a panel adopts: the kit's rules, the token defaults, then the game's file. */
export function sheetText(css) {
  const defaults = Object.entries(DEFAULT_TOKENS).map(([name, value]) => `--ui-${name}: ${value};`).join(' ')
  return `${BASE_CSS}\n:host { ${defaults} }\n${css.replace(/:root/g, ':host')}`
}

/** Screen's palette, from tokens. */
export function screenPaletteOf(tokens) {
  return Object.fromEntries(Object.entries(SCREEN_TOKENS).map(([key, token]) => [key, tokens[token]]))
}

/** The HUD's colours, from tokens. */
export const hudPaletteOf = tokens => ({ ink: tokens.ink, outline: tokens.outline })
