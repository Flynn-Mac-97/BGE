export default {
  about: 'turn at a steady rate',

  // `speed` here means degrees per second. float.js also has a `speed` and it
  // means something else entirely — which is fine, because each behaviour
  // reads its own bag and never sees the other one's.
  properties: { speed: 120 },

  update(entity, seconds, context, self) {
    entity.rotation += self.speed * seconds
  }
}
