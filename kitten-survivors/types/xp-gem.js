/**
 * The little glowing thing a dead enemy leaves behind.
 *
 * It is the whole economy of the game: everything you kill turns into one of
 * these, and every level you gain came out of a pile of them. So it is small,
 * bright, and it never stops turning — a field of still gems reads as scenery,
 * and a field of turning ones reads as money on the floor.
 *
 * It carries no physics body on purpose. It settles to the ground itself, and
 * stops doing so the moment Pickups latches it — a gem still falling while the
 * magnet pulls it in fights the magnet all the way.
 */

/** Radians a second the size pulse runs at, and how much of the size it moves. */
const PULSE_RATE = 5.5
const PULSE_DEPTH = 0.08

/** The idle bob: radians a second, and metres each way. */
const BOB_RATE = 4
const BOB_HEIGHT = 0.07

/**
 * How far the bottom of a gem rests above the meadow.
 *
 * Not zero: the grass has height, and a gem flush with the ground disappears
 * into it. Small enough that the gem reads as lying on the meadow — anything
 * more and it reads as hovering, which is what a pickup must never do.
 */
const RESTS_ABOVE_GROUND = 0.05

/** Metres a second a gem falls to its resting height. */
const SETTLE_SPEED = 2.4

/** The meadow is one flat slab, so the floor under every gem is the same. */
const GROUND = 0

export default {
  about: 'what a dead enemy drops, and the whole economy. Every level gained came from collecting these',
  appearance: 'A small bright cyan cube lying on the grass, turning and bobbing where it fell. It drops to the ground wherever its enemy died, and the Pickups plugin draws it to the player from there.',
  looksWrongWhen: 'it hangs in mid-air, or it has stopped turning — a gem left by a flying enemy must fall to the grass, and a still one reads as scenery',

  mesh: {
    box: [0.22, 0.22, 0.22],
    tint: '#5ec8ff'
  },

  properties: {
    // Pickups reads these two. `pickup` is the kind, and Kitten Progression is
    // what decides that the kind "experience" means experience points.
    pickup: 'experience',
    value: 1

    // No `bobHeight`: Pickups bobs about wherever the gem was dropped, which
    // for a crow's gem is 1.1 m of open air. The bob is below instead, about a
    // height this file settles the gem down to first.
  },

  update(entity, seconds, context) {
    // Turning, not tumbling: one axis, slowly, so a hundred of them on screen
    // read as one shimmering field rather than as noise.
    entity.rotation = (entity.rotation + seconds * 1.8) % (Math.PI * 2)

    // A pulse in size, phased off where the gem stands, so two hundred of them
    // twinkle instead of throbbing as one. Engine time, so a replay twinkles
    // the same. Small: the gem must still read as an object, not an effect.
    const phase = entity.x * 1.7 + entity.z * 2.3
    entity.scale = 1 + Math.sin(context.time * PULSE_RATE + phase) * PULSE_DEPTH

    // Latched means Pickups is flying it to the kitten. Two things moving one
    // gem fight, which is why this type carries no physics body either.
    if (!entity.pickupMotion?.latched) settle(entity, seconds, context, phase)
  }
}

/**
 * Falls to its resting height, then bobs there.
 *
 * A gem is dropped where its enemy died, lifted 0.3 m, so a crow's gem starts
 * at about 1.1 m — higher than anything on the meadow is tall. Without this it
 * hangs there for the rest of the run.
 */
function settle(entity, seconds, context, phase) {
  const half = (Number(entity.mesh?.box?.[1]) || 0.22) / 2
  const rest = GROUND + half + RESTS_ABOVE_GROUND
  const from = entity.restingY ?? entity.y
  entity.restingY = Math.max(rest, from - SETTLE_SPEED * seconds)
  entity.y = entity.restingY + Math.sin(context.time * BOB_RATE + phase) * BOB_HEIGHT
}
