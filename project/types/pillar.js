/** A stair pillar behind the fighters. Pillars scroll left while the hero walks and wrap around, so the stair seems endless. */
const WRAP = 18

export default {
  about: 'a background pillar of the endless stair',
  appearance: 'A tall, thin, dark grey column behind the fighters.',
  looksWrongWhen: 'it stands in front of the fighters or stops scrolling while the hero walks',

  mesh: { box: [0.35, 6, 0.35], tint: '#2a2a2a' },

  update(entity, seconds, context) {
    const facts = context.blackBell?.scene() ?? { isShown: false }
    entity.hidden = !facts.isShown
    entity.x -= (context.descentScene?.speed ?? 0) * seconds
    if (entity.x < -WRAP / 2) entity.x += WRAP
  }
}
