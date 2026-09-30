/**
 * Game UI key capture: hand the next key press to a callback, for a rebinding
 * row. The press is queued and the callback runs on the fixed step, so a replay
 * repeats it. While a capture waits, the page's keydown goes to it first and
 * nothing else sees the key. Esc cancels with `null`.
 */
import { makeUiEvent } from './records.js'

/** The `captureKey`, `isCapturing`, `feedKey` and `clear` verbs for one context. */
export function makeCapture(state) {
  let waiting = null

  const capture = {
    /** Take the next key press for `callback(code)`. Replaces a capture already waiting. */
    captureKey(callback) {
      waiting = callback
    },
    isCapturing: () => Boolean(waiting),

    /** Give a key press to a waiting capture, as the page's keydown does. True when it was taken. */
    feedKey(code) {
      if (!waiting) return false
      const callback = waiting
      waiting = null
      state.queue.push({ ...makeUiEvent('ui:capture', 'captured', code === 'Escape' ? null : code, 'key', { type: 'key' }), callback })
      return true
    },

    /** Forget a waiting capture. */
    clear() {
      waiting = null
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', event => {
      if (!capture.feedKey(event.code)) return
      event.preventDefault()
      event.stopImmediatePropagation()
    }, { capture: true })
  }
  return capture
}
