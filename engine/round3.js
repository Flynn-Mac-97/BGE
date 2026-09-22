/**
 * Kernel: round a number to three decimals before it is written down.
 *
 * A time or place quantised this way round-trips through JSON and hashes the
 * same across runs, so a difference below the third decimal cannot make two
 * equal moments look different.
 */
export function round3(value) {
  return Math.round(value * 1000) / 1000
}
