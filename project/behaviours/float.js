export default {
  about: 'bob up and down around where it started',

  properties: { speed: 2, amplitude: 0.3 },

  // `self` is this behaviour's own bag on the entity, also readable as entity.float.
  // Running state goes in there, never on the entity, so two behaviours on the
  // same entity can never collide over a name.
  start(entity, context, self) {
    self.base = entity.y
  },

  // Sets y outright rather than adding to it, so it does not fight anything
  // else that moves the entity. Do not attach this to a physics body — the
  // body writes y too, and the last writer wins every step.
  update(entity, seconds, context, self) {
    entity.y = self.base + Math.sin(context.time * self.speed) * self.amplitude
  }
}
