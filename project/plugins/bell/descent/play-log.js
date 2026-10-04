/**
 * The play log: a plain-text account of finished and current runs, forged items and rated duels,
 * for a player to copy and share. A run record is `{ crew, floor, level, bells, evolutions, tomes: { vigor, might }, build: [{ type, level, position }], log: [line] }`.
 */
import { rules } from '../rules.js'
import { escape } from '../inspection.js'
import { descentCrew } from './pool.js'
import { towerUpgrades } from './tower.js'
import { forgeName, forgeDescription } from './forge.js'

export const HISTORY_LIMIT = 20

/** The record of a run, for the profile's history. */
export function runRecord(run) {
  return { crew: run.crew, floor: run.floor, level: run.level, bells: run.bells, evolutions: run.evolutions, tomes: run.tomes ?? {},
    build: Object.values(run.items).map(item => ({ type: item.type, level: item.level, position: item.position })), log: run.log ?? run.story }
}

function runText(record, heading) {
  const crew = descentCrew[record.crew]?.name ?? record.crew
  const build = record.build.map(item => `${rules.catalog.items[item.type]?.name ?? item.type} L${item.level} ${item.position ? `@${item.position.join(',')}` : '(reserve)'}`).join('; ')
  return [`== ${heading}: ${crew} · floor ${record.floor} · LV ${record.level} · ${record.bells} Bells · ${record.evolutions} evolutions${record.tomes?.vigor || record.tomes?.might ? ` · tomes: vigor ${record.tomes.vigor ?? 0}, might ${record.tomes.might ?? 0}` : ''}`, `Build: ${build}`, ...record.log.map(line => '  ' + line)].join('\n')
}

/** The whole log as text, newest run first. */
export function playLogText(profile) {
  const tower = Object.entries(profile.tower).map(([id, rank]) => `${towerUpgrades[id]?.name ?? id} ${rank}`).join(', ') || 'none'
  const lines = [`BLACK BELL PLAY LOG · ${profile.bells} Bells · deepest floor ${profile.bestFloor} · ${profile.runs} runs`, `Tower: ${tower}`]
  if (profile.forged.length) lines.push(`Forged: ${profile.forged.map(record => `${forgeName(record)} (${forgeDescription(record)})`).join(' | ')}`)
  if (profile.journey?.descent) lines.push(runText(runRecord(profile.journey.descent), 'RUN IN PROGRESS'))
  profile.history.forEach((record, index) => lines.push(runText(record, `RUN ${profile.runs - index}`)))
  if (profile.duels.length) lines.push('== DUELS (fun 1-3)', ...profile.duels.slice(0, 20).map(duel => `  fun ${duel.fun} · ${duel.winner === null ? 'draw' : `P${duel.winner + 1} won`} in ${duel.cycles} cycles · ${duel.builds.map(build => build.map(type => rules.catalog.items[type]?.name ?? type).join('+')).join(' vs ')} · rules ${JSON.stringify(duel.rules)}`))
  return lines.join('\n')
}

/** The play log screen: the text in a box, and a button to copy it. */
export function playLogView(kit, state) {
  return `<main class="tavern-game descent-hub play-log"><header><strong>PLAY LOG</strong><span>LAST ${HISTORY_LIMIT} RUNS</span><div>${kit.button('Back to the Lantern', { action: 'hub' })}</div></header><section class="tavern-story" role="status"><p>${escape(state.logNotice || 'Copy this and paste it into a chat to share how your runs went.')}</p></section><section class="play-log-body">${kit.button('Copy the log', { action: 'copyLog', kind: 'primary' })}<textarea readonly aria-label="Play log">${escape(playLogText(state.profile))}</textarea></section></main>`
}
