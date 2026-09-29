/**
 * Game UI typewriter: how much of a line a person has read so far.
 *
 * `revealedChars` is a pure function of the line and the seconds since it
 * began, so a replay shows the same text on the same step. Each character takes
 * `1 / speed` seconds; a full stop, `!` or `?` waits a little longer and a comma
 * a little less, so speech has a rhythm.
 */

/** Extra seconds after a character, by character. */
const PAUSES = { '.': 0.25, '!': 0.25, '?': 0.25, ',': 0.12, ';': 0.12, ':': 0.12 }

/** How many characters of `text` show after `elapsed` seconds at `speed` characters a second. */
export function revealedChars(text, elapsed, speed = 30) {
  if (elapsed === Infinity) return text.length
  let clock = 0
  for (let index = 0; index < text.length; index++) {
    clock += 1 / speed + (PAUSES[text[index]] ?? 0)
    if (clock > elapsed) return index
  }
  return text.length
}
