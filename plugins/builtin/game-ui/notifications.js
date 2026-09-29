/**
 * Game UI notifications: a stack of short messages that slide in, wait, and fade
 * out. One panel holds them; it is made with the first message and taken down
 * with the last. A message lasts `life` seconds of game time, so it pauses with
 * the game, and a click dismisses it early.
 */
import { kit } from './components.js'
import { removeNow } from './lifecycle.js'

const PANEL = 'ui:notifications'

/** The most messages on screen; a new one past it pushes the oldest off. */
const MAX_NOTES = 6

/** Seconds before its end that a message starts to fade. */
const FADE_SECONDS = 0.3

/** The `notify` and `clear` verbs for one context. */
export function makeNotifications(context, state) {
  const notes = []
  let count = 0

  const dismiss = id => {
    const index = notes.findIndex(note => note.id === id)
    if (index !== -1) notes.splice(index, 1)
    if (!notes.length) removeNow(context, state, PANEL)
  }

  const noteHtml = note => {
    const isFading = context.time >= note.endsAt - FADE_SECONDS
    return kit.target(kit.toast(note.text, { tone: note.tone }), { action: 'dismiss', value: note.id, class: isFading ? 'ui-fade-out' : 'ui-slide-left', key: note.id })
  }

  return {
    /** Show a message. `tone` is `good`, `danger` or `accent`; `life` is seconds (default 3). Answers its id. */
    notify(text, { tone, life = 3 } = {}) {
      const id = `note:${count++}`
      notes.push({ id, text, tone, endsAt: context.time + life })
      if (notes.length > MAX_NOTES) notes.shift()
      if (!state.panels.has(PANEL)) {
        context.gameUi.show(PANEL, { html: () => kit.element(notes.map(noteHtml), { class: 'ui-notifications' }), on: { dismiss } })
      }
      context.gameUi.playSound(tone ? `notify-${tone}` : 'notify')
      context.after(life, () => dismiss(id))
      return id
    },

    /** Forget every message. The panel goes with the run, so this only empties the list. */
    clear() {
      notes.length = 0
    }
  }
}
