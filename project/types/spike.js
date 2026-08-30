export default {
  about: 'a floor hazard. Touching it sends the player back to the start. It never moves',
  appearance: 'A low spike sprite lying flat on the ground, wider than it is tall, and always still.',
  looksWrongWhen: 'it floats above the floor, or the player runs over it unharmed — the 0.35 high box must rest on the surface.',

  sprite: { image: 'spike.png', width: 0.8, height: 0.8 },
  collider: { box: [0.8, 0.35] },
  properties: { damage: 1 }
}
