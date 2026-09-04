export default {
  about: 'the figure a person moves',
  appearance: 'A one-metre upright figure, the tallest thing in the level.',
  looksWrongWhen: 'it is the same height as the ground tiles.',

  sprite: { image: 'probe.png', width: 0.8, height: 1 },
  collider: { box: [0.8, 1] },
  properties: { body: 'dynamic', speed: 4 }
}
