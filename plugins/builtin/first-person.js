/**
 * First Person — the weapon in the player's hands.
 *
 * The kernel renderer draws one frame from a pass graph and owns no game
 * concept. A first-person weapon is a game concept: it needs its own camera, a
 * depth buffer cleared under it and a light of its own, because a model half a
 * metre from the eye pushes into every wall in the shared world pass. Those
 * three things belong to a pass, and a pass belongs to whoever draws it.
 *
 * This plugin draws that pass and owns the model, the sway offsets and the key
 * light. Game code holds a weapon through `context.viewmodel`:
 *
 *   context.viewmodel.set({ model: 'weapons/ak47.glb', attachments: { hands: 'hands.glb' } })
 *   context.viewmodel.offset({ x: 0.01, y: -0.02, z: 0.03 }, { x: 0.02, y: 0.01, z: 0 })
 *
 * The pass orders after the world and before the UI. A post chain that grades
 * the world orders itself before this pass, so the weapon draws on top of the
 * graded picture rather than being overwritten by it.
 */
import { makeViewmodel } from './first-person/viewmodel.js'

/**
 * Register the viewmodel pass and publish `context.viewmodel`.
 *
 * The renderer exists after every plugin has loaded, so this runs on the
 * events that fire once it does, and does nothing when there is no renderer.
 * A world with no card still answers the API; only the draw is skipped.
 */
function attach(context) {
  const renderer = context?.renderer
  if (!renderer?.graph || typeof renderer.graph.add !== 'function') return false
  // The pass replaces any record already under the name, so a second attach on
  // the same context has nothing to add.
  if (context.viewmodel) return true

  const viewmodel = makeViewmodel({
    renderer: renderer.threeRenderer || null,
    release: renderer.dispose || (() => {})
  })
  context.viewmodel = viewmodel.model

  renderer.graph.add({
    name: 'viewmodel',
    after: ['scene'],
    before: ['ui'],
    // The world drawn a moment ago filled the depth buffer; the weapon is
    // measured against an empty one so no wall can be in front of it.
    depth: 'clear',
    execute: frame => viewmodel.draw(frame)
  })
  return true
}

/** Take the pass off and unpublish the API. Runs when the plugin is disabled. */
function detach(context) {
  const renderer = context?.renderer
  if (renderer?.graph && typeof renderer.graph.remove === 'function') renderer.graph.remove('viewmodel')
  if (context?.viewmodel) delete context.viewmodel
}

export default {
  name: 'First Person',
  category: 'visuals',
  lifecycle: 'scoped',
  about: 'The weapon in the player\'s hands, drawn in its own pass.',

  onLoad(context, scope) {
    attach(context)
    scope?.on('shell:ready', () => attach(context))
    scope?.on('level:loaded', () => attach(context))
    scope?.defer(() => detach(context))
  }
}
