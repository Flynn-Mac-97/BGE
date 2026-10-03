/** The floor the fighters stand on: a long flat strip whose top face is at height 0. */
export default {
  about: 'the stair landing the fighters stand on',
  appearance: 'A long, thin, grey strip under the fighters, with its top at height 0.',
  looksWrongWhen: 'the fighters float above it or sink into it',

  mesh: { box: [40, 0.04, 2], tint: '#5a5a5a' },

  update(entity, seconds, context) {
    entity.hidden = !(context.blackBell?.scene().isShown)
  }
}
