/** An invisible point the side camera looks at, between the two fighters. */
export default {
  about: 'the camera target between the fighters',
  appearance: 'Nothing; it is never drawn.',
  looksWrongWhen: 'it can be seen',
  start(entity) { entity.hidden = true }
}
