export default {
  about: 'a patrolling enemy. Flies a fixed distance either side of where it was placed, bobbing as it goes',
  appearance: 'A small bat sprite about a metre across, drifting side to side and rising and falling as it moves.',
  looksWrongWhen: 'it sits still, or drifts further from its placement each pass — `home` was not recorded at start.',

  sprite: { image: 'bat.png', width: 0.9, height: 0.9 },
  collider: { box: [0.7, 0.5] },
  properties: { speed: 2, range: 3 },

  start(entity) {
    entity.home = entity.x
    entity.direction = 1
  },

  update(entity, seconds, context) {
    entity.x += entity.direction * entity.properties.speed * seconds
    if (Math.abs(entity.x - entity.home) > entity.properties.range) entity.direction *= -1
    // context.time, not performance.now(): engine time replays, the wall clock does not.
    entity.y += Math.sin(context.time * 2.5) * seconds * 0.6
  }
}
