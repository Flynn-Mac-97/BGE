export default {
  about: 'walk back and forth a fixed distance from where it started',

  properties: { speed: 2, distance: 3 },

  start(entity, context, self) {
    self.from = entity.x
    self.direction = 1
  },

  update(entity, seconds, context, self) {
    entity.x += self.speed * self.direction * seconds

    // Snapped to the limit before turning, or a fast patrol drifts further out
    // every lap — the overshoot is never given back.
    if (Math.abs(entity.x - self.from) < self.distance) return
    entity.x = self.from + Math.sign(entity.x - self.from) * self.distance
    self.direction = -self.direction
    entity.flip = self.direction < 0
  }
}
