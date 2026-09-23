/**
 * The determinism lint for a project's JavaScript.
 *
 * Split from `project-index.mjs`, which keeps building the index and
 * re-exports `lint` so callers and tests keep one door. A file that reaches
 * around the engine's clock, random stream or scheduler makes a run
 * unrepeatable, which breaks `simulate()`.
 */

/**
 * Reaching around the engine's clock, random stream or scheduler.
 *
 * Each of these makes a run unrepeatable, which quietly breaks `simulate()` —
 * the thing the whole change-run-compare loop rests on. They are reported
 * rather than blocked: it is the author's project, but nobody should discover
 * this by watching two identical runs disagree.
 */
const BANNED = [
  [/\bperformance\s*\.\s*now\s*\(/, 'performance.now() is the wall clock — use context.time'],
  [/\bDate\s*\.\s*now\s*\(/, 'Date.now() is the wall clock — use context.time'],
  [/\bnew\s+Date\s*\(/, 'new Date() is the wall clock — use context.time'],
  [/\bMath\s*\.\s*random\s*\(/, 'Math.random() cannot be replayed — use context.random()'],
  [/\bsetTimeout\s*\(/, 'setTimeout runs on the wall clock — use context.after(seconds, fn)'],
  [/\bsetInterval\s*\(/, 'setInterval runs on the wall clock — use context.every(seconds, fn)'],
  [/\brequestAnimationFrame\s*\(/, 'requestAnimationFrame does not run in a hidden tab — use the update hook']
]

/** Report determinism problems in one file, with line numbers. */
export function lint(file, text) {
  const out = []
  text.split('\n').forEach((line, i) => {
    if (/^\s*(\/\/|\*)/.test(line)) return // a comment may name them
    for (const [re, why] of BANNED) {
      if (re.test(line)) out.push({ file, line: i + 1, why, code: line.trim().slice(0, 80) })
    }
  })
  return out
}
