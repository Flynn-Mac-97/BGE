export default {
  about: 'the character the person at the keyboard drives. Walks, jumps, takes coins, resets on a hazard',
  appearance: 'A small animated figure about a metre tall, facing the way it moves. Idle, walk and jump each look different.',
  looksWrongWhen: 'it slides with its legs still, or faces away from its movement — `animation` and `flip` are set every frame.',

  // A sheet plus the size of one cell. Frames are numbered left to right.
  sprite: { sheet: 'player.png', size: [16, 16], width: 0.9, height: 0.9 },

  animation: {
    idle: 0,
    walk: { frames: [1, 2], framesPerSecond: 8 },
    jump: { frames: [3], loop: false }
  },

  sounds: { jump: 'jump.wav', hurt: 'hurt.wav' },

  collider: { box: [0.6, 0.9] },
  properties: { body: 'dynamic', speed: 6, jump: 11 },

  start(entity, context) {
    entity.velocityX = 0
    entity.velocityY = 0
    context.world.state = { score: 0, coins: context.world.all('coin').length }
  },

  update(entity, seconds, context) {
    const move = context.input.axis('x')
    entity.velocityX = move * entity.properties.speed

    if (context.input.held('jump') && entity.grounded) {
      entity.velocityY = entity.properties.jump
      entity.play('jump')
    }

    // Assignment, not play(): saying what it *is* doing needs no memory of
    // what it *was* doing.
    entity.animation = !entity.grounded ? 'jump' : move ? 'walk' : 'idle'
    if (move) entity.flip = move < 0

    if (entity.y < -8) reset(entity, context)
  },

  onCollide(entity, other, context) {
    if (other.type === 'spike') reset(entity, context)
  }
}

function reset(entity, context) {
  entity.x = 2
  entity.y = 3
  entity.velocityY = 0
  entity.play('hurt')
  context.camera.shake(0.35)
}
