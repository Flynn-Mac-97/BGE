/**
 * What a run cost, in RMB, at DeepSeek's published price for the model its
 * agents run on.
 *
 * A token count is not a cost. The price is per million tokens, it differs for a
 * cached input, a fresh input and an output, and it halves outside Beijing
 * working hours. So the price is written down here once, with the page it came
 * from and the day it was read: a cost that cannot be traced to a price is a
 * guess wearing a currency symbol.
 *
 * Output tokens already include reasoning tokens — the harness reports an input,
 * a cache read and an output that add up to its total, and reasoning is counted
 * inside the output. Adding reasoning again would double-bill it.
 *
 * Prices change. If a cost here disagrees with a bill, this table is what is
 * stale, not the token counts.
 */
export const PRICING = {
  model: 'deepseek-flash',
  modelVersion: 'DeepSeek-V4.1-Flash',
  currency: 'CNY',
  unit: '1M tokens',
  readAt: '2026-09-18',
  source: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing',
  rates: {
    peak: { cacheHit: 0.04, cacheMiss: 2, output: 8 },
    offPeak: { cacheHit: 0.02, cacheMiss: 1, output: 4 }
  }
}

/** Beijing working hours, as the price table states them. */
const PEAK_WINDOWS = [[9 * 60, 12 * 60], [14 * 60, 18 * 60]]

/**
 * Whether a moment is billed at the peak price.
 *
 * Beijing time, Monday to Friday, 09:00-12:00 and 14:00-18:00. The offset is
 * applied to the instant rather than read from the machine, so a run priced on
 * a laptop in another time zone is priced the same.
 */
export function bandAt(at = new Date()) {
  const beijing = new Date(at.getTime() + 8 * 60 * 60 * 1000)
  const day = beijing.getUTCDay()
  const minutes = beijing.getUTCHours() * 60 + beijing.getUTCMinutes()
  const weekday = day >= 1 && day <= 5
  const inWindow = PEAK_WINDOWS.some(([from, to]) => minutes >= from && minutes < to)
  return weekday && inWindow ? 'peak' : 'offPeak'
}

/**
 * The cost of one token total, at one band.
 *
 * A total missing a field is priced as zero for that field and reported as
 * `priced: false`, because a cost computed from half a usage record is worse
 * than one that says it could not be computed.
 */
export function costOf(tokens, { band = 'peak' } = {}) {
  if (!tokens || typeof tokens.totalTokens !== 'number') {
    return { rmb: null, band, priced: false, why: 'no token usage was recorded' }
  }
  const rates = PRICING.rates[band] ?? PRICING.rates.peak
  const million = 1_000_000
  const miss = (tokens.inputTokens ?? 0) / million
  const hit = (tokens.cacheReadTokens ?? 0) / million
  const output = (tokens.outputTokens ?? 0) / million

  const parts = {
    cacheMiss: miss * rates.cacheMiss,
    cacheHit: hit * rates.cacheHit,
    output: output * rates.output
  }
  return {
    rmb: Number((parts.cacheMiss + parts.cacheHit + parts.output).toFixed(6)),
    band,
    priced: true,
    parts: Object.fromEntries(Object.entries(parts).map(([key, value]) => [key, Number(value.toFixed(6))]))
  }
}

/**
 * What the same tokens cost at each band.
 *
 * Both, because a long run crosses the boundary: it starts inside Beijing
 * working hours and finishes outside them, and one number would be wrong for
 * part of it. The band a moment falls in is reported alongside.
 */
export function costBands(tokens, at = new Date()) {
  const band = bandAt(at)
  return {
    band,
    peak: costOf(tokens, { band: 'peak' }).rmb,
    offPeak: costOf(tokens, { band: 'offPeak' }).rmb,
    now: costOf(tokens, { band }).rmb,
    totalTokens: tokens?.totalTokens ?? null,
    priced: Boolean(tokens && typeof tokens.totalTokens === 'number')
  }
}

/** A sum of per-candidate costs, keeping both bands. */
export function sumCosts(costs = []) {
  const totals = { peaking: 0, offPeak: 0, now: 0, tokens: 0, priced: 0, band: null }
  for (const cost of costs) {
    if (!cost?.priced) continue
    totals.peaking += cost.peak ?? 0
    totals.offPeak += cost.offPeak ?? 0
    totals.now += cost.now ?? 0
    totals.tokens += cost.totalTokens ?? 0
    totals.priced++
    // Carried so a total can say which hour it was worked out at, rather than
    // leaving a caller to guess and report the wrong price band.
    if (cost.band) totals.band = cost.band
  }
  return {
    peak: Number(totals.peaking.toFixed(6)),
    offPeak: Number(totals.offPeak.toFixed(6)),
    now: Number(totals.now.toFixed(6)),
    totalTokens: totals.tokens,
    priced: totals.priced,
    band: totals.band
  }
}

/** RMB, to the fen for anything worth reading and to six places below that. */
export function formatRmb(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return value >= 0.01 ? `¥${value.toFixed(2)}` : `¥${value.toFixed(6)}`
}

/** The line every surface shows, so a cost reads the same everywhere. */
export function describeCost(cost) {
  if (!cost?.priced) return 'cost unknown'
  return `${formatRmb(cost.now)} at the ${cost.band === 'peak' ? 'peak' : 'off-peak'} price (${formatRmb(cost.offPeak)}–${formatRmb(cost.peak)} depending on the hour)`
}
