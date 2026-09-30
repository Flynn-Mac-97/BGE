/**
 * Game UI effects: full-viewport layers for a hit flash, a low-health vignette,
 * a fade to black, letterbox bars, a blur behind a pause. One panel holds them
 * under the game's own panels; it exists while any effect does.
 *
 * An effect is a name and a few CSS variables. The name is a class, `ui-fx-<name>`,
 * so the kit's presets and a game's own (written in theme.css) work alike. One
 * with a `life` removes itself after that many seconds of game time; one with
 * none stays until it is cleared, and fades out for its `leave` seconds first.
 */
import { kit } from './components.js'
import { removeNow } from './lifecycle.js'

const PANEL = 'ui:effects'

/** Mount order: over the world's anchors (40) and under every other panel (50). */
const EFFECTS_ORDER = 45

/** Seconds a cleared effect takes to fade out. */
const DEFAULT_LEAVE = 0.4

/** Theme colours by name; any other value is used as a CSS colour if it looks like one. */
const TOKEN_COLORS = { danger: 'var(--ui-danger)', good: 'var(--ui-good)', accent: 'var(--ui-accent)', ink: 'var(--ui-ink)', scrim: 'var(--ui-scrim)' }
const PLAIN_COLOR = /^[#\w(),.% -]+$/

/** The `style` text for an effect's options: `--color`, `--strength` (0 to 1) and `--life`. */
function variablesOf({ color, strength, life }) {
  const declarations = []
  if (color) declarations.push(`--color:${TOKEN_COLORS[color] ?? (PLAIN_COLOR.test(color) ? color : 'transparent')}`)
  if (strength !== undefined) declarations.push(`--strength:${Number(strength) || 0}`)
  if (life) declarations.push(`--life:${Number(life)}s`)
  return declarations.join(';')
}

/** The `effect`, `clearEffect`, `effects` and `clear` verbs for one context. */
export function makeEffects(context, state) {
  const active = []
  let count = 0

  const remove = id => {
    const index = active.findIndex(effect => effect.id === id)
    if (index !== -1) active.splice(index, 1)
    if (!active.length) removeNow(context, state, PANEL)
  }

  const effectHtml = effect => kit.element('', {
    class: `ui-fx ui-fx-${effect.name} ${effect.className}`.trim(),
    style: effect.style,
    key: effect.id,
    attributes: { 'data-leaving': effect.isLeaving }
  })

  return {
    /**
     * Start an effect. `name` is letters, digits and dashes. Options: `life`
     * (seconds, or it stays), `color` (`danger` `good` `accent` `ink` `scrim` or
     * a CSS colour), `strength` (0 to 1), `class`. Answers its id, or '' for a bad name.
     */
    effect(name, { life, color, strength, class: className = '' } = {}) {
      if (!/^[a-z0-9-]+$/.test(name)) return ''
      const id = `fx:${count++}`
      active.push({ id, name, className, style: variablesOf({ color, strength, life }), isLeaving: false })
      if (!state.panels.has(PANEL)) context.gameUi.show(PANEL, { order: EFFECTS_ORDER, html: () => active.map(effectHtml).join('') })
      if (life) context.after(life, () => remove(id))
      return id
    },

    /** Fade out and remove one effect by id, or every effect of that name, over `leave` seconds. */
    clearEffect(idOrName, { leave = DEFAULT_LEAVE } = {}) {
      for (const effect of active.filter(candidate => candidate.id === idOrName || candidate.name === idOrName)) {
        if (effect.isLeaving) continue
        effect.isLeaving = true
        effect.style += `;--life:${leave}s`
        context.after(leave, () => remove(effect.id))
      }
    },

    /** What is running: `{ id, name, isLeaving }`. */
    effects: () => active.map(({ id, name, isLeaving }) => ({ id, name, isLeaving })),

    /** Forget every effect. The panel goes with the run, so this only empties the list. */
    clear() {
      active.length = 0
    }
  }
}
