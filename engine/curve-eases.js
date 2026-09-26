/**
 * Kernel: every ease a curve key may name — how a value leaves one key for the
 * next, as a function from 0 to 1 over the gap.
 *
 * The first five are the engine's own: 'linear', 'smooth' (slow at both
 * ends), 'in', 'out' and 'hold' (stays until the next key). The rest are the
 * standard animator's set (Robert Penner's, as easings.net shows them, and as
 * After Effects and most engines name them): a family name and a side,
 * 'cubic-out', 'back-in-out', 'elastic-out', 'bounce-out'.
 *
 *   in      starts slow, ends fast
 *   out     starts fast, ends slow; the side most motion wants
 *   in-out  slow at both ends
 *
 * Families: sine, quad, cubic, quart, quint, expo, circ (smooth to sharp);
 * back (goes past the end, or back before the start); elastic (springs);
 * bounce (lands and bounces).
 */

/** How far 'back' swings past its ends; Penner's constant, a tenth past. */
const BACK = 1.70158

const TURN = Math.PI * 2

/** Each family as its 'in' side, 0 to 1. The other two sides follow from it. */
const FAMILIES = {
  sine: share => 1 - Math.cos((share * Math.PI) / 2),
  quad: share => share ** 2,
  cubic: share => share ** 3,
  quart: share => share ** 4,
  quint: share => share ** 5,
  expo: share => (share === 0 ? 0 : 2 ** (10 * share - 10)),
  circ: share => 1 - Math.sqrt(1 - share ** 2),
  back: share => (BACK + 1) * share ** 3 - BACK * share ** 2,
  elastic: share => elasticIn(share),
  bounce: share => 1 - bounceOut(1 - share)
}

function elasticIn(share) {
  if (share === 0 || share === 1) return share
  return -(2 ** (10 * share - 10)) * Math.sin((share * 10 - 10.75) * (TURN / 3))
}

/** A ball dropped onto the floor: four landings, each lower. */
function bounceOut(share) {
  const stretch = 7.5625
  const span = 2.75
  if (share < 1 / span) return stretch * share ** 2
  if (share < 2 / span) return stretch * (share - 1.5 / span) ** 2 + 0.75
  if (share < 2.5 / span) return stretch * (share - 2.25 / span) ** 2 + 0.9375
  return stretch * (share - 2.625 / span) ** 2 + 0.984375
}

/** A family's three sides, named `<family>-in`, `<family>-out` and `<family>-in-out`. */
function sidesOf(family, easeIn) {
  return {
    [`${family}-in`]: easeIn,
    [`${family}-out`]: share => 1 - easeIn(1 - share),
    [`${family}-in-out`]: share => (share < 0.5 ? easeIn(share * 2) / 2 : 1 - easeIn(2 - share * 2) / 2)
  }
}

/** Every ease by name. */
export const EASES = {
  linear: share => share,
  smooth: share => share * share * (3 - 2 * share),
  in: share => share * share,
  out: share => 1 - (1 - share) ** 2,
  hold: () => 0,
  ...Object.assign({}, ...Object.entries(FAMILIES).map(([family, easeIn]) => sidesOf(family, easeIn)))
}
