/**
 * The kitten you play. Small, quick, and always running from something.
 *
 * Movement is top-down on the ground plane: the keys steer X and Z, and Y is
 * left to gravity. That is the whole of the control scheme in a survivor — you
 * steer, and the weapons fire themselves.
 */
const WIDTH = 0.5
const HEIGHT = 0.45

export default {
  mesh: {
    box: [WIDTH, HEIGHT, 0.8],
    tint: '#e8c88a'
  },

  collider: { box: [WIDTH, HEIGHT, 0.8] },

  properties: {
    body: 'dynamic',
    speed: 5,
    health: 100,
    maxHealth: 100
  },

  update(entity, seconds, context) {
    // axis('y') is the up/down keys, which on a top-down floor is forward and
    // back along Z. Away from the camera is negative Z.
    const sideways = context.input.axis('x')
    const forward = context.input.axis('y')

    // A diagonal must not be faster than a straight line, or the whole game is
    // played at 45 degrees.
    const length = Math.hypot(sideways, forward) || 1
    const speed = entity.properties.speed

    entity.velocityX = (sideways / length) * speed
    entity.velocityZ = (-forward / length) * speed

    // Face where you are going. Nothing reads this yet; the mesh will.
    if (sideways || forward) entity.yaw = Math.atan2(sideways, -forward)
  }
}
