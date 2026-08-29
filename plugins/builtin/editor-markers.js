/**
 * Editor Markers — things that exist to be seen while building, and not while playing.
 *
 * A spawn point, a patrol node, a trigger volume, a camera hint, a goal marker:
 * all of them are real entities that a level genuinely contains, and all of
 * them have to be visible and draggable in the viewport or they cannot be
 * authored. None of them should be a coloured box standing in the middle of the
 * map while somebody is playing.
 *
 * The type says what it is, once:
 *
 *   // types/spawn-point.js
 *   marker: true,
 *
 * and this plugin hides every one of them the moment play starts, then puts them
 * back when it stops. The alternative — a `start` hook on each type setting
 * `entity.hidden` — asks a type to guess whether anybody is looking at it, which
 * is not something a type can know. Where a thing is drawn is the editor's
 * business, so it is the editor that answers.
 *
 * `hidden` only stops it being drawn. A marker keeps its collider, so a trigger
 * volume still reports the player standing in it while invisible, which is
 * exactly what a trigger is for.
 */
export default {
  name: 'Editor Markers',

  onLoad(context) {
    // Remembered per entity rather than assumed, because a level is allowed to
    // hide something for its own reasons and stopping play must not reveal it.
    const hiddenByUs = new Set()

    const isMarker = entity => entity._definition?.marker === true

    const markers = () => context.world.entities.filter(isMarker)

    context.bus.on('play:started', () => {
      for (const entity of markers()) {
        if (entity.hidden) continue
        entity.hidden = true
        hiddenByUs.add(entity.id)
      }
    })

    context.bus.on('play:stopped', () => {
      for (const entity of context.world.entities) {
        if (!hiddenByUs.has(entity.id)) continue
        entity.hidden = false
      }
      hiddenByUs.clear()
    })

    // A marker spawned mid-play — a round manager placing a spawn point, say —
    // has to arrive already hidden, or it appears out of nowhere in front of a
    // player. The listener runs for every entity, so the marker test comes first.
    context.bus.on('entity:added', entity => {
      if (!context.loop.running || !isMarker(entity) || entity.hidden) return
      entity.hidden = true
      hiddenByUs.add(entity.id)
    })

    context.markers = {
      list: () => markers().map(entity => entity.id),
      /** Show them during play anyway — the one thing you want while debugging a spawn. */
      reveal(on = true) {
        for (const entity of markers()) entity.hidden = !on && context.loop.running
        if (on) hiddenByUs.clear()
        return { revealed: on, count: markers().length }
      }
    }
  },

  commands: [
    {
      id: 'markers.list',
      label: 'Which entities are editor-only markers',
      run: context => ({
        markers: context.markers.list(),
        hiddenNow: context.world.entities.filter(e => e._definition?.marker && e.hidden).length
      })
    },
    {
      id: 'markers.reveal',
      label: 'Show markers during play',
      run: (context, on) => context.markers.reveal(on ?? true)
    }
  ]
}
