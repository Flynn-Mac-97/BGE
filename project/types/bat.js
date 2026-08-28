export default {
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
