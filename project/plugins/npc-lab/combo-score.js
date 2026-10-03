/** Explicit experimental objectives are relative to a roster, never universal item power. */
export const objectives = ['strength', 'burst', 'sustain', 'efficiency', 'work']
export function scoreReport(report, cost, objective) {
  const count = report.matches.length
  const margin = report.matches.reduce((sum, match) => sum + match.health.first - match.health.second, 0) / count
  const strength = report.winRate * 100 + margin
  const scores = {
    strength: () => strength,
    burst: () => report.matches.reduce((sum, match) => sum + (match.winner === 'first' ? 100 / match.cycles : 0), 0) / count,
    sustain: () => report.matches.reduce((sum, match) => sum + (match.health.first > 0 ? 100 : 0) + match.health.first, 0) / count,
    efficiency: () => strength / Math.max(1, cost),
    work: () => report.work / count
  }
  if (!scores[objective]) throw new TypeError('Unknown search objective')
  return scores[objective]()
}
