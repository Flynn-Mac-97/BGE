/**
 * Game UI sounds: the short sounds a UI plays for what a person does.
 *
 * A sound is named for the event: `click` `hover` `focus` `open` `close` `notify`
 * `toggle` `tab` `select` `slide` `pickup` `drop`. Its file comes from the
 * theme, `--ui-sound-click: ui/sounds/click.wav;`, so the one theme file sets how
 * the UI looks and sounds, or from `gameUi.sounds({ click: '...' })` in code.
 * A name with no file is silent. Some fall back to another (`tab` to `click`), so
 * one `click` sound covers the lot until a game wants more.
 *
 * Sounds play through `context.play` on the fixed step, from game time, so they
 * never feed back into the world. The same name plays at most once every 0.05 s.
 */

/** Sound by event type. The type wins over the control's kind. */
const TYPE_SOUNDS = { dragstart: 'pickup', drop: 'drop', hover: 'hover', focus: 'focus' }

/** Sound by control kind, for a press. A kind absent here clicks. */
const KIND_SOUNDS = { toggle: 'toggle', slider: 'slide', select: 'select', tab: 'tab', key: 'close' }

/** Event types that are a person pressing something. Others (pointerover, dragend) are silent. */
const PRESS_TYPES = new Set(['click', 'key', 'change', 'input', 'contextmenu', 'dblclick'])

/** The sound to use when a name has no file of its own. */
const FALLBACKS = {
  tab: 'click', toggle: 'click', select: 'click', pickup: 'click', drop: 'click',
  'notify-good': 'notify', 'notify-danger': 'notify', 'notify-accent': 'notify'
}

/** Seconds of game time before the same sound may play again, so a dragged slider is not a buzz. */
const MIN_GAP = 0.05

/** The sound an event makes, or '' for none. */
export function soundOfEvent(event) {
  const byType = TYPE_SOUNDS[event.type]
  if (byType) return byType
  if (!PRESS_TYPES.has(event.type)) return ''
  return KIND_SOUNDS[event.kind] ?? 'click'
}

/** A theme token's value as a file name: quotes dropped. */
const fileOfToken = value => (value ? String(value).replace(/^["']|["']$/g, '') : '')

/** The `sounds` and `play` verbs for one context. */
export function makeSounds(context, state) {
  const explicit = {}
  const lastPlayed = new Map()

  const fileFor = name => explicit[name] ?? fileOfToken(state.theme.tokens[`sound-${name}`])

  return {
    /** Set files by sound name, over the theme's. */
    set(map) {
      Object.assign(explicit, map)
    },

    /** Play a sound by name. Answers the file played, or '' when there is none or it played a moment ago. */
    play(name) {
      const file = fileFor(name) || fileFor(FALLBACKS[name])
      // Game time can go back (a level reload, a rewind); a last play in the future is no reason to wait.
      const sinceLast = context.time - (lastPlayed.get(name) ?? -Infinity)
      if (!file || (sinceLast >= 0 && sinceLast < MIN_GAP)) return ''
      lastPlayed.set(name, context.time)
      context.play?.(file, { volume: Number(state.theme.tokens['sound-volume']) || 1 })
      return file
    }
  }
}
