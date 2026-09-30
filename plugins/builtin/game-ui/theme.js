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
  ink: '#ffffff',
  quiet: 'rgba(255, 255, 255, 0.7)',
  surface: 'rgba(0, 0, 0, 0.8)',
  edge: 'rgba(255, 255, 255, 0.25)',
  accent: '#60a5fa',
  'on-accent': '#000000',
  track: 'rgba(255, 255, 255, 0.12)',
  scrim: 'rgba(0, 0, 0, 0.6)',
  outline: 'rgba(0, 0, 0, 0.75)',
  good: '#4ade80',
  danger: '#f87171',
  trail: 'rgba(255, 255, 255, 0.5)',
  font: 'system-ui, sans-serif',
  size: '16px',
  radius: '0px',
  space: '8px',
  duration: '0.15s',
  ease: 'ease-out'
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
