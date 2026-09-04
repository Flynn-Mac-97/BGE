export default {
  about: 'a prop that turns, so a test can prove the fixed step ran',
  appearance: 'A half-metre marker, turning steadily.',
  looksWrongWhen: 'it stands still while the world is playing.',

  sprite: { image: 'probe.png', width: 0.5, height: 0.5 },
  properties: { spin: 120 },

  // one frame passed
  update(entity, seconds) {
    entity.rotation += entity.properties.spin * seconds
  }
}
