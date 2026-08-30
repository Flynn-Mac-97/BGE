/**
 * The little thing a dead enemy leaves behind.
 *
 * It is the whole economy of the game: everything you kill turns into one of
 * these, and every level you gain came out of a pile of them. So it is small
 * and it never stops turning — a field of still gems reads as scenery, and a
 * field of turning ones reads as money on the floor.
 *
 * It is LOOT, not a threat, and there are dozens on screen at once. Nothing the
 * player does not have to react to may outrank the player, so no gem is drawn
 * at the strength it is declared at. Kitten Progression picks a hue and a size
 * per worth tier and merges them over the mesh below; `toneDownLoot` takes
 * whatever arrives, keeps the hue, and cuts the chroma and the size.
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

/** A gem of the lowest worth: one kill, and the size every tier is read against. */
const SMALLEST = 0.22
const TIER_HUE = '#5ec8ff'

/**
 * How far toward mid grey every gem's tier hue is mixed, and the grey it is
 * mixed with.
 *
 * Mixing toward one grey scales the gaps between the three channels by the same
 * factor, so the hue comes through exactly and only chroma and value move. That
 * is what keeps the worth tiers apart while taking the shout out of them. At
 * 0.45 the three tier tints go from 0.34, 0.51 and 0.65 luminance to 0.27, 0.36
 * and 0.43, under the props' 0.46 to 0.70 and far under the cat's 0.92, and no
 * tier keeps more than half its saturation.
 */
const TOWARD_GREY = 0.45
const LOOT_GREY = 133

/** Of the size the drop asked for. Loot is found by hue, not by bulk. */
const LOOT_SIZE = 0.85

export default {
  about: 'what a dead enemy drops, and the whole economy. Every level gained came from collecting these',
  appearance: 'A small muted cube turning and bobbing on the grass — dusty cyan for one kill, dusty green and dusty pink for more. Darker than the grass it lies on and never the brightest thing in frame.',
  looksWrongWhen: 'it hangs in mid-air, it has stopped turning, or it is a saturated cube brighter than the kitten — loot must lie on the grass, keep moving, and never outrank the player',

  // The lowest tier, stated at full strength like the other two in Kitten
  // Progression's list. `toneDownLoot` runs over this default as well, so both
  // routes into the world end at the same loudness.
  mesh: {
    box: [SMALLEST, SMALLEST, SMALLEST],
    tint: TIER_HUE
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
    // In update rather than start: a gem is spawned into a running world and
    // never goes through the start hook.
    if (!entity.tonedDown) toneDownLoot(entity)

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
 * Take one gem down to the loot band, once.
 *
 * The mesh is replaced rather than written into: a gem dropped with no override
 * is handed the TYPE's own mesh object, and writing to that would repaint every
 * gem in the world.
 */
function toneDownLoot(entity) {
  const asked = entity.mesh || {}
  const box = Array.isArray(asked.box) ? asked.box : [SMALLEST, SMALLEST, SMALLEST]
  entity.mesh = {
    ...asked,
    box: box.map(metres => metres * LOOT_SIZE),
    tint: mixedTowardGrey(asked.tint || TIER_HUE)
  }
  entity.tonedDown = true
}

/** One '#rrggbb' colour, mixed toward LOOT_GREY. Hue survives it exactly. */
function mixedTowardGrey(hex) {
  const digits = String(hex).replace('#', '')
  if (digits.length !== 6) return hex
  let out = '#'
  for (let start = 0; start < 6; start += 2) {
    const channel = parseInt(digits.slice(start, start + 2), 16)
    if (!Number.isFinite(channel)) return hex
    const mixed = Math.round(channel * (1 - TOWARD_GREY) + LOOT_GREY * TOWARD_GREY)
    out += mixed.toString(16).padStart(2, '0')
  }
  return out
}

/**
 * Falls to its resting height, then bobs there.
 *
 * A gem is dropped where its enemy died, lifted 0.3 m, so a crow's gem starts
 * at about 1.1 m — higher than anything on the meadow is tall. Without this it
 * hangs there for the rest of the run.
 */
function settle(entity, seconds, context, phase) {
  const half = (Number(entity.mesh?.box?.[1]) || SMALLEST * LOOT_SIZE) / 2
  const rest = GROUND + half + RESTS_ABOVE_GROUND
  const from = entity.restingY ?? entity.y
  entity.restingY = Math.max(rest, from - SETTLE_SPEED * seconds)
  entity.y = entity.restingY + Math.sin(context.time * BOB_RATE + phase) * BOB_HEIGHT
}
