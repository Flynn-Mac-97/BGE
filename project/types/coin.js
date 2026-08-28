export default {
  sprite: { image: 'coin.png', width: 0.5, height: 0.5 },
  sounds: { pickup: 'coin.wav' },
  collider: { circle: 0.22 },
  properties: { value: 10, spin: 120 },

  // one frame passed
  update(entity, seconds) {
    entity.rotation += entity.properties.spin * seconds
  },

  // began touching `other`
  onCollide(entity, other, context) {
    if (other.type !== 'player') return
    context.world.state.score = (context.world.state.score || 0) + entity.properties.value
    context.world.state.coins = Math.max(0, (context.world.state.coins ?? 1) - 1)
    entity.play('pickup')
    context.destroy(entity)
  }
}
