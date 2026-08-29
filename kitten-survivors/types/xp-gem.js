/**
 * The little glowing thing a dead enemy leaves behind.
 *
 * It is the whole economy of the game: everything you kill turns into one of
 * these, and every level you gain came out of a pile of them. So it is small,
 * bright, and it never stops turning — a field of still gems reads as scenery,
 * and a field of turning ones reads as money on the floor.
 *
 * It carries no physics body on purpose. Pickups moves it, and a gem that also
 * fell under gravity would fight the magnet all the way in.
 */
export default {
  mesh: {
    box: [0.22, 0.22, 0.22],
    tint: '#5ec8ff'
  },

  properties: {
    // Pickups reads these three. `pickup` is the kind, and Kitten Progression
    // is what decides that the kind "experience" means experience points.
    pickup: 'experience',
    value: 1,

    // The idle bob, so a gem waiting to be collected still moves.
    bobHeight: 0.07,
    bobSpeed: 4
  },

  update(entity, seconds) {
    // Turning, not tumbling: one axis, slowly, so a hundred of them on screen
    // read as one shimmering field rather than as noise.
    entity.rotation = (entity.rotation + seconds * 1.8) % (Math.PI * 2)
  }
}
