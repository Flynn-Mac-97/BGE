export default {
  about: 'the planted C4. Exists only after a plant completes — a carried bomb is a field, not an entity',
  appearance: 'A small dark-red brick on the ground inside a bomb site. Until the c4 model loads it draws as its collider box.',
  looksWrongWhen: 'there is more than one, or one exists before a plant completed',

  // The planted C4. It exists only once it is in the ground — nobody places one
  // in a level and nothing carries one around as an entity, because a carried
  // bomb is a field on the carrier (`entity.hasBomb`) and not a thing in the
  // world. Match Rules spawns exactly one of these when a plant completes.
  //
  // `model` is the vocabulary for solid art; until a loader for it lands the
  // renderer falls back to the collider's box, so this draws as a small red
  // brick rather than as nothing. A bomb you cannot see is a bomb nobody
  // defuses, and an invisible round-winner is the worst thing this file could
  // ship.
  mesh: { model: 'counter-strike/models/c4.glb', tint: '#c0392b' },
  collider: { box: [0.34, 0.22, 0.26] },

  // A trigger: it is felt, it pushes nothing, and it never blocks a defuser who
  // is trying to stand on top of it.
  properties: {
    body: 'trigger',
    fuse: 35,
    // The beep interval, at the moment of planting and at the last second.
    // These two numbers are information, not decoration: the rate is how a
    // defender across the site knows whether there is time to walk over or time
    // only to run, and flattening them would take a real decision out of the
    // game.
    beepSlowest: 1,
    beepFastest: 0.09,
    site: 'A'
  },

  sounds: {
    plant: 'assets/counter-strike/sounds/bomb-plant.wav',
    beep: 'assets/counter-strike/sounds/bomb-beep.wav',
    explode: 'assets/counter-strike/sounds/bomb-explode.wav',
    defused: 'assets/counter-strike/sounds/bomb-defuse.wav'
  },

  start(entity, context) {
    arm(entity, context)
  },

  update(entity, seconds, context) {
    // Also here, because `start` only runs for entities that were in the level
    // when play began — and this one is always spawned mid-round.
    arm(entity, context)
    if (entity.defused === true || entity.exploded === true) return

    const remaining = entity.explodesAt - context.time
    if (remaining <= 0) {
      // The bomb owns going off, and the round reads `exploded` off it. One
      // thing decides, one thing announces it, and a bomb dropped into a level
      // by hand still counts down with nothing else loaded.
      entity.exploded = true
      entity.play?.('explode')
      context.camera?.shake(1.2)
      // The generic `explosion` lane: the engine's particles and decals listen
      // to it, so a bomb going off is a bomb going off in any game that speaks
      // the lane.
      context.bus.emit('explosion', {
        at: { x: entity.x, y: entity.y, z: entity.z || 0 },
        entity
      })
      return
    }

    if (context.time < entity.nextBeepAt) return
    entity.play?.('beep')
    const fraction = Math.max(0, Math.min(1, remaining / (entity.properties.fuse || 1)))
    const slowest = entity.properties.beepSlowest
    const fastest = entity.properties.beepFastest
    entity.nextBeepAt = context.time + fastest + (slowest - fastest) * fraction
  }
}

/**
 * Give it a deadline if nothing else has.
 *
 * Match Rules writes `explodesAt` the moment it spawns one, so the round and the
 * bomb never hold two versions of the same clock. The fallback is for a bomb
 * that arrived some other way — placed in a level, spawned from the CLI — which
 * should still tick rather than sit there inert.
 */
function arm(entity, context) {
  if (entity.explodesAt == null) entity.explodesAt = context.time + entity.properties.fuse
  if (entity.nextBeepAt == null) entity.nextBeepAt = context.time
}
