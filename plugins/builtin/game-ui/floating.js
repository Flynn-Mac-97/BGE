/**
 * Game UI floating text: a damage number or a pickup that rises from a point
 * and goes. Each is an anchor of its own, read from its point once, so it stays
 * where it happened. A burst is capped, oldest first, so it cannot grow the page.
 */
import { escapeHtml, kit } from './components.js'
import { removeNow } from './lifecycle.js'
import { resolveTarget } from './world-layer.js'

/** The most floating texts alive at once. */
const FLOAT_CAP = 200

/** The `float` verb for one context. */
export function makeFloats(context, state) {
  const alive = []
  let count = 0

  return {
    /**
     * Show text at a point. `at` is an entity id, an entity or a `[x, y, z]`
     * point. It rises and fades over `life` seconds of game time (a `tone` of
     * `danger`, `good` or `accent` colours it), then goes. Answers the id, or ''
     * when `at` names nothing.
     */
    float(text, { at, life = 1, offset = [0, 1.2, 0], tone, class: className = '', html } = {}) {
      const { point } = resolveTarget(at, context.world)
      if (!point) return ''
      const id = `float:${count++}`
      const content = kit.element(html ?? escapeHtml(text), { class: `ui-floating ${className}`.trim(), style: `--life:${life}s`, attributes: { 'data-tone': tone } })
      context.gameUi.anchor(id, { to: point, offset, html: content })
      alive.push(id)
      context.after(life, () => removeNow(context, state, id))
      for (const stale of alive.splice(0, Math.max(0, alive.length - FLOAT_CAP))) removeNow(context, state, stale)
      return id
    }
  }
}
