/**
 * The three things that make a moving thing readable, and who gets them.
 *
 * A keyline is a dark line of CONSTANT SCREEN WIDTH round a silhouette; a
 * contact shadow is a soft ellipse under it; a ground ring is a coloured band
 * on the floor round its feet. The first two belong on the things a player
 * tracks — the characters, the enemies, the pickups — and on nothing else: a
 * line round every tuft of grass is edge detail, not readability. "Has moved
 * since it appeared" is the renderer's own answer to which is which, read off
 * the record merging already keeps, and any mesh overrides it by declaring
 * `keyline` in pixels or `shadow` in metres. A `parts` body and a model both
 * work; a GLB's own materials are never touched, so a model gets its keyline
 * even though it cannot be given a material at all.
 *
 * The ring is handed out differently: it names ONE actor. It answers "which
 * one is mine" in a crowd where a silhouette cannot, and a hundred of them
 * mark nothing.
 *
 * All three are drawn in the scene, so a frame taken without the interface
 * layer, at a stated size, or by a tab in the background still carries them.
 *
 * Kept apart from the object builder because a mark is drawn beside an entity
 * rather than by it: a keyline and a floor mark are geometry the renderer builds,
 * and a model's own materials are never touched to make room for them.
 *
 * Each mark registers through `renderer.marks`, the same door a plugin uses.
 * Each kind owns its geometry, material and cache in its own module —
 * `keyline-marks`, `contact-shadows`, `ground-rings` — over the instance-quad
 * helpers both floor marks share in `floor-mark`. This file owns the defaults,
 * the rule for who gets what, and the frame-level begin and place each kind
 * needs.
 */
import { makeKeylineMarks } from './keyline-marks.js'
import { makeContactShadows } from './contact-shadows.js'
import { makeGroundRings } from './ground-rings.js'

/**
 * Kernel: the defaults and the rule for who gets a readability mark.
 *
 * Every number here is a default a game may set through `renderer.readability`.
 */
export function makeReadability() {
  return {
    keyline: 2.2,               // screen pixels
    keylineColour: '#1d1418',
    shadow: true,
    shadowColour: '#0d1409',
    shadowStrength: 0.44,
    /**
     * Who gets a ground ring: `'followed'` — the entity the camera follows —
     * or `false`, or an entity id or type name. There is deliberately no
     * setting for every actor; `mesh.ring` names any extras one at a time.
     */
    ring: 'followed',
    ringColour: '#4fd8ff',
    ringStrength: 0.85,
    /** Where the floor is. The same y `toWorld` drops an unhit ray onto. */
    groundY: 0,
    /** Metres of lift over which a shadow spreads out and fades to nothing. */
    shadowRange: 1.6
  }
}

export function makeReadabilityMarks(state) {
  const keylines = makeKeylineMarks(state)
  const contactShadows = makeContactShadows(state)
  const groundRings = makeGroundRings(state)

  /**
   * The keyline, and the record fact `stats.keylines` counts.
   *
   * It runs for every mesh entity, as every mark does. The keyline module's own
   * width check makes a never-moved thing with no keyline one cheap read.
   */
  function drawKeyline(entity, object, place, declared, record) {
    keylines.updateKeyline(entity, object, declared, record.shape, record.moved, record)
    record.keyline = record.keylineMesh !== null
  }

  /** The contact shadow of one entity. A hidden entity draws no floor mark. */
  function drawContactShadow(entity, object, place, declared, record) {
    if (entity.hidden) return
    contactShadows.noteContactShadow(entity, declared, record.shape, record.moved, place)
  }

  /** The ground ring of one entity, when the ring rule or `mesh.ring` names it. */
  function drawGroundRing(entity, object, place, declared, record) {
    if (entity.hidden) return
    groundRings.noteGroundRing(entity, declared, record.shape, place)
  }

  // Registered in the order the frame drew them before the registry existed:
  // keyline, then contact shadow, then ground ring.
  state.marks.register('keyline', { draw: drawKeyline })
  state.marks.register('contactShadow', { draw: drawContactShadow })
  state.marks.register('groundRing', { draw: drawGroundRing })

  /** Start a frame's marks: no shadow and no ring noted yet. */
  function beginMarks() {
    contactShadows.beginMarks()
    groundRings.beginMarks()
  }

  /** How many marks this frame noted, for `stats`. */
  function markCounts() {
    return { contactShadows: contactShadows.count(), groundRings: groundRings.count() }
  }

  state.noteContactShadow = contactShadows.noteContactShadow
  state.placeContactShadows = contactShadows.placeContactShadows
  state.placeGroundRings = groundRings.placeGroundRings
  state.growShadowData = contactShadows.growShadowData
  state.beginMarks = beginMarks
  state.markCounts = markCounts
}
