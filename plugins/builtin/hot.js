/**
 * Live File Updates — apply a file change to the running editor.
 *
 * An agent writes `project/types/coin.js` with its ordinary file tools and the
 * change is live, with the world still where it was: same entities, same
 * positions, same selection. No page reload, so no losing the state you were
 * about to inspect.
 *
 * This is a plugin rather than kernel because it is an authoring convenience —
 * a built game never needs it, and the kernel should not carry a dev-server
 * socket into production.
 *
 * What it can and cannot swap:
 *
 *   types      swapped in place; live entities move onto the new definition
 *   behaviours the same, and running state in the behaviour's own bag survives
 *   levels   reloaded if it is the one open and you have no unsaved changes
 *   tests    picked up on the next run, no reload
 *   assets   textures re-fetched
 *   plugins  a full page reload, announced — a plugin owns DOM and listeners,
 *            and unloading one safely is a different job from this one
 *
 * One exception, and it is Vite's rather than ours: *deleting* a project file
 * reloads the page. Vite does not consult plugins on unlink, so it reaches for
 * a full reload before anything here runs. Editing, adding and breaking a file
 * are all handled in place, which is the loop that actually matters.
 */
export default {
  name: 'Live File Updates',

  onLoad(context) {
    const hot = import.meta.hot
    if (!hot) return

    hot.on('engine:changed', async change => {
      try {
        const result = await apply(change, context)
        if (result) {
          context.bus.emit('hot:applied', { ...change, ...result })
          console.log(`%c[hot] ${describe(change, result)}`, 'color:#888')
          context.redraw()
        }
      } catch (e) {
        // A broken file is normal while writing one. Report it and carry on
        // with the old definition still running, rather than taking the
        // editor down over a half-finished edit.
        console.error(`[hot] ${change.file} — ${e.message}`)
        context.bus.emit('hot:failed', { ...change, error: String(e.message || e) })
        context.redraw()
      }
    })
  },

  commands: [{
    id: 'hot.reloadType',
    label: 'Reload a type from disk',
    run: (context, name) => context.editor.reloadType(name)
  }]
}

async function apply({ event, file, kind, name }, context) {
  if (kind === 'type') {
    return await context.editor.reloadType(name)
  }

  if (kind === 'behaviour') {
    return await context.editor.reloadBehaviour(name)
  }

  if (kind === 'level') {
    // Only the level actually on screen, and only when nothing would be lost.
    if (name !== context.level()) return { skipped: 'not the open level' }
    if (context.world.simulated) return { skipped: 'world is simulated — stop first' }
    if (event === 'unlink') return { skipped: 'level deleted' }
    await context.editor.loadLevel(name)
    return { reloaded: true }
  }

  if (kind === 'test') {
    // The tests plugin reads the index each run, so there is nothing to swap —
    // just make sure the index it reads is current.
    context.editor.index = await context.files.index()
    return { indexed: true }
  }

  if (kind === 'image' || kind === 'sound' || kind === 'model') {
    context.renderer?.forget?.(file)
    return { asset: true }
  }

  // Plugins and anything else: the safe answer is a reload, but say why.
  if (file.startsWith('plugins/')) {
    console.log(`%c[hot] ${file} changed — reloading (plugins cannot swap in place)`, 'color:#888')
    location.reload()
    return null
  }

  context.editor.index = await context.files.index()
  return { indexed: true }
}

const describe = (c, r) =>
  r.removed ? `${c.file} removed`
  : r.entities != null ? `${c.file} → ${r.entities} ${r.entities === 1 ? 'entity' : 'entities'} updated`
  : r.reloaded ? `${c.file} reloaded`
  : r.skipped ? `${c.file} — ${r.skipped}`
  : `${c.file} ${c.event}`
