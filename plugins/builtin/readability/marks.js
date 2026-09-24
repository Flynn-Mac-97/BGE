/**
 * Readability: the defaults and who gets a mark.
 *
 * A keyline is a dark line of CONSTANT SCREEN WIDTH round a silhouette; a
 * contact shadow is a soft ellipse under it; a ground ring is a coloured band
 * on the floor round its feet. A shadow belongs on the things a player tracks —
 * the characters, the enemies, the pickups — and on nothing else. "Has moved
 * since it appeared" is the renderer's own answer to which is which, read off
 * the record merging already keeps. A keyline is off by default; a mesh asks
 * for one by declaring `keyline` in pixels, and `shadow` in metres overrides
 * the shadow.
 *
 * The ring is handed out differently: it names ONE actor. It answers "which one
 * is mine" in a crowd where a silhouette cannot, and a hundred of them mark
 * nothing.
 *
 * Each kind owns its geometry, material and cache in its own module —
 * `keyline`, `contact-shadow`, `ground-ring` — over the instance-quad helpers
 * both floor marks share in `floor-mark`. Each registers through
 * `renderer.marks`, the same door any plugin uses, and says through that door
 * when it needs a full pass, which entity it holds, and how many marks it drew.
 */
import { makeKeylineMarks } from './keyline.js'
import { makeContactShadows } from './contact-shadow.js'
import { makeGroundRings } from './ground-ring.js'

/**
 * The defaults every number in a mark falls back to, written to
 * `renderer.readability` so a game may set them in place.
 */
export function makeReadability() {
  return {
    // Screen pixels. 0: a keyline is an effect a type asks for with
    // `mesh.keyline`, not a default on everything that moves.
    keyline: 0,
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

/**
 * The three marks, in the order the frame draws them.
 *
 * `host` is `{ scene, view, release, readability }`, read from the renderer.
 */
export function readabilityMarks(host) {
  return [
    { name: 'keyline', mark: makeKeylineMarks(host) },
    { name: 'contactShadow', mark: makeContactShadows(host) },
    { name: 'groundRing', mark: makeGroundRings(host) }
  ]
}
