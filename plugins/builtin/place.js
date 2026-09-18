/**
 * Place And Attach — drop things into the viewport.
 *
 * Before this there was no way to add an entity from the editor at all. You
 * could move, scale, rotate, duplicate and delete — but the first one of
 * anything had to be typed into a level file by hand, which made the whole
 * editor an editor of things somebody else created.
 *
 * The gesture is the drag itself: pick something up out of the project browser,
 * drop it where you want it. Nothing to arm, no mode to leave.
 *
 * Where you let go decides what it means:
 *
 *   a type       anywhere          places one there
 *   a behaviour  on an entity      attaches to that entity
 *   a behaviour  on empty space    refused, and says why
 */
export default {
  name: 'Place And Attach',

  category: 'editor',
  onLoad(context) {
    // The viewport does not exist yet at load time, so wait for the shell.
    context.bus.on('shell:ready', () => attach(context))
  },

  commands: [{
    id: 'place.at',
    label: 'Place a type',
    // args: ['coin', 4, 2]
    run: (context, args) => {
      const [type, x = 0, y = 0] = [].concat(args)
      return place(context, type, Number(x), Number(y))
    }
  }]
}

function attach(context) {
  const viewport = context.shell.viewport
  if (!viewport || viewport._placeAttached) return
  viewport._placeAttached = true

  const wanted = event => event.dataTransfer?.types?.includes('application/x-engine')

  viewport.addEventListener('dragover', event => {
    if (!wanted(event)) return
    // Without preventDefault the browser refuses the drop entirely, and the
    // failure looks like "dragging does nothing" rather than an error.
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    viewport.classList.add('dropping')
  })

  viewport.addEventListener('dragleave', event => {
    if (event.target === viewport) viewport.classList.remove('dropping')
  })

  viewport.addEventListener('drop', event => {
    viewport.classList.remove('dropping')
    if (!wanted(event)) return
    event.preventDefault()

    let payload
    try { payload = JSON.parse(event.dataTransfer.getData('application/x-engine')) } catch { return }

    const rect = viewport.getBoundingClientRect()
    const px = event.clientX - rect.left, py = event.clientY - rect.top

    if (payload?.kind === 'type') {
      const at = context.renderer.toWorld(px, py)
      return place(context, payload.name, at.x, at.y)
    }

    if (payload?.kind === 'behaviour') {
      // Front-most hit, the same one a click would select — so what you drop
      // on is what you would have selected, and there is nothing to learn.
      const [hit] = context.renderer.pick(context.world, px, py)
      if (!hit) {
        console.warn(`[place] "${payload.name}" needs an entity — drop it on one`)
        return
      }
      try {
        context.run('behaviour.attach', [hit.id, payload.name])
        context.select(hit.id)
        context.redraw()
      } catch (e) {
        console.error(`[place] ${e.message}`)
      }
    }
  })
}

/**
 * Put one there, select it, save.
 *
 * Snapped to a half unit, matching what the transform tool falls back to when
 * nothing else is nearby — a dropped entity should land where a dragged one
 * would.
 */
function place(context, type, x, y) {
  if (!context.world.types.has(type)) throw new Error(`no type "${type}"`)

  if (context.world.simulated) {
    // The level holds start positions. Adding one mid-simulation would be lost
    // on the next stop, silently, which is worse than refusing.
    console.warn('[place] the world has been simulated — stop first, or the placement is lost')
    return { skipped: 'simulated' }
  }

  const e = context.spawn(type, { at: [snap(x), snap(y), 0] })
  context.select(e.id)
  context.save()
  context.redraw()
  return { id: e.id, type, at: [e.x, e.y] }
}

const snap = n => Math.round(n * 2) / 2
