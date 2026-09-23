/**
 * Readability — the three marks drawn over a moving thing: a keyline, a
 * contact shadow and a ground ring.
 *
 * The renderer owns one GL context and one draw order and must never learn what
 * a keyline is. This plugin owns all three marks, the defaults they fall back
 * to, and the `mesh.keyline` / `mesh.shadow` / `mesh.ring` keys a level
 * declares. Each mark registers through `renderer.marks`, the same door any
 * plugin uses, and through that door says when it needs a full pass, which
 * entity it holds, and how many marks it drew.
 *
 * The Render plugin switches all three off at once with `readability: off`,
 * writing `renderer.readability`.
 */
import { makeReadability, readabilityMarks } from './readability/marks.js'

/** The renderer the marks are registered into, so a second attach is free. */
let attached = null

/**
 * Register the three marks and fill `renderer.readability` with the defaults.
 *
 * The renderer exists after every plugin has loaded, so this runs on the
 * events that fire once it does, and does nothing when there is no renderer.
 */
function attach(context) {
  const renderer = context?.renderer
  if (!renderer?.marks || typeof renderer.marks.register !== 'function') return false
  if (attached === renderer) return true

  const readability = renderer.readability || (renderer.readability = {})
  Object.assign(readability, makeReadability())
  const host = { scene: renderer.scene, view: renderer.view, release: renderer.dispose, readability }
  for (const { name, mark } of readabilityMarks(host)) renderer.marks.register(name, mark)

  context.readability = readability
  attached = renderer
  return true
}

export default {
  name: 'Readability',
  category: 'visuals',
  about: 'The keyline, contact shadow and ground ring drawn over a moving thing.',

  onLoad(context) {
    // The renderer is attached after every plugin loads, so both events that
    // fire once it exists are where the marks register.
    context.bus?.on('shell:ready', () => attach(context))
    context.bus?.on('level:loaded', () => attach(context))
    attach(context)
  }
}
