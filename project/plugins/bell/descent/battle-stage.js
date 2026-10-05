/**
 * The battle stage, laid out like a handheld monster battle: the foe's framed portrait top right
 * with its nameplate, the hero bottom left with HP, and a battle text box. The Descent and the Duel Pit share it. Each resolved step
 * plays short CSS effects (lunge, hit blink, HP drain, pop-ups, faint), keyed by the step so each plays once.
 */
import { art } from '../art.js'
import { rules, itemDefinition } from '../rules.js'
import { escape } from '../inspection.js'
import { statusText, shortStat } from '../glance.js'
import { placedItems } from '../../grid-game/grid.js'
import { descentCrew } from './pool.js'
import { embersNeeded } from './run.js'

const crest = { normal: '', elite: '◆ ELITE', boss: '♛ BOSS' }
// A hit that takes this share of max health or more shakes the whole stage and is called a crushing blow.
const QUAKE_SHARE = 0.4

// In a duel both sides may own the same item, so an item's name carries its owner's tag, such as (P2).
const nameOf = (battle, subject) => {
  if (subject.kind !== 'item') return battle.actors[subject.id].name
  const owner = battle.actors[battle.items[subject.id].owner]
  return itemDefinition(battle, subject.id).name + (owner.short ? ` (${owner.short})` : '')
}
const percent = (health, max) => Math.max(0, Math.min(100, Math.round(100 * health / max)))

/** What a resolved step did to each fighter: `{ recruit: moment, enemy: moment, attacker }`. */
function stepMoments(step) {
  const blank = () => ({ hit: 0, blocked: 0, healed: 0, guarded: 0, statuses: [], isTick: false })
  const moments = { recruit: blank(), enemy: blank(), attacker: null }
  if (step?.kind !== 'ability') return moments
  for (const effect of step.effects) {
    if (effect.target.kind !== 'actor') continue
    const moment = moments[effect.target.id]
    const record = {
      damage: () => { moment.hit += effect.amount; moment.blocked += effect.blocked ?? 0; moment.isTick = moment.isTick || Boolean(step.statusId) },
      heal: () => { moment.healed += effect.amount },
      guard: () => { moment.guarded += effect.amount },
      applyStatus: () => { if (effect.amount) moment.statuses.push(statusText(effect.status, effect.amount)) }
    }[effect.type]
    record?.()
  }
  const struck = step.effects.some(effect => effect.type === 'damage' && (effect.amount || effect.blocked))
  if (struck && !step.statusId) moments.attacker = step.source.kind === 'actor' ? step.source.id : step.state.items[step.source.id]?.owner ?? null
  return moments
}

/** The battle box sentence for one resolved step, or '' for bookkeeping steps. */
export function battleLine(step) {
  if (step?.kind === 'combatEnd') return step.winner === 'crew' ? `${step.state.actors.enemy.name} fainted!` : `${step.state.actors.recruit.name} fell!`
  if (step?.kind !== 'ability') return ''
  const battle = step.state
  const source = step.statusId ? rules.catalog.statuses[step.statusId].name : nameOf(battle, step.source)
  // Stack decay and spent statuses are bookkeeping; the box reports what a player would notice.
  const lines = step.effects.filter(effect => (effect.amount || effect.blocked) && !['removeStatus', 'consumeStatus'].includes(effect.type)).map(effect => {
    const target = nameOf(battle, effect.target)
    const actor = effect.target.kind === 'actor' ? battle.actors[effect.target.id] : null
    const sentences = {
      damage: () => {
        if (step.statusId) return `${target} is hurt by ${source}! −${effect.amount}`
        if (!effect.amount) return `${target} blocks ${source}!`
        return `${source} hits ${target} for ${effect.amount}!${effect.amount >= actor.maxHealth * QUAKE_SHARE ? ' A crushing blow!' : ''}`
      },
      heal: () => `${target} recovers ${effect.amount} HP.`,
      modifyStat: () => `${source} readies ${target}: ${effect.amount > 0 ? '+' : ''}${effect.amount} ${shortStat(effect.stat)}.`,
      resource: () => `${target} gains ${effect.amount} ${effect.resource}.`,
      removeGuard: () => `${source} breaks ${effect.amount} of ${target}'s guard!`,
      triggerItem: () => `${source} rings: ${target} acts again!`,
      guard: () => `${target} braces: +${effect.amount} guard.`,
      applyStatus: () => actor ? `${target} suffers ${rules.catalog.statuses[effect.status].name}: ${statusText(effect.status, effect.amount)}.` : `${target} is readied: ${statusText(effect.status, effect.amount)}.`
    }
    return sentences[effect.type]?.() ?? `${source} → ${target}.`
  })
  return lines.join(' ')
}

function hpBar(actor, moment, serial) {
  const after = percent(actor.health, actor.maxHealth)
  const before = percent(actor.health + moment.hit - moment.healed, actor.maxHealth)
  const trail = before > after ? `<i class="hp-trail" data-key="trail:${serial}" style="--from:${before}%;--to:${after}%"></i>` : ''
  return `<div class="hp-line"><b>HP</b><div class="hp-bar ${after <= 25 ? 'low' : ''}">${trail}<i class="hp-fill" style="width:${after}%"></i></div></div>`
}

function pops(moment, serial) {
  const marks = []
  if (moment.hit) marks.push(`<span class="pop pop-hit">−${moment.hit}</span>`)
  else if (moment.blocked) marks.push('<span class="pop pop-block">BLOCK</span>')
  if (moment.healed) marks.push(`<span class="pop pop-heal">+${moment.healed}</span>`)
  if (moment.guarded) marks.push(`<span class="pop pop-guard">+${moment.guarded} GD</span>`)
  for (const status of moment.statuses) marks.push(`<span class="pop pop-status">${escape(status)}</span>`)
  return marks.length ? `<div class="pops" data-key="pops:${serial}">${marks.join('')}</div>` : ''
}

/** Movement classes for a fighter's portrait this step: lunge, hit, tick, faint. */
function motionClasses(id, moments, actor) {
  const moment = moments[id]
  return [moments.attacker === id ? 'lunge' : '', moment.hit ? 'hit' : '', moment.isTick ? 'tick' : '', actor.health <= 0 ? 'faint' : ''].filter(Boolean).join(' ')
}
/** Glow classes, on their own layer so a heal or guard never cancels a lunge or hit. */
const glowClasses = moment => [moment.healed ? 'healed' : '', moment.guarded ? 'guarded' : ''].filter(Boolean).join(' ')

function statusPills(actor) {
  const pills = Object.entries(actor.statuses).map(([id, status]) => `<span class="pill">${escape(rules.catalog.statuses[id].short ?? rules.catalog.statuses[id].name.slice(0, 3).toUpperCase())} ${status.stacks}</span>`)
  if (actor.guard) pills.push(`<span class="pill">GD ${actor.guard}</span>`)
  return pills.join('')
}

function portrait(kit, side, image, label, actor, moments, state, floor, rank) {
  const classes = motionClasses(side, moments, actor)
  const glow = glowClasses(moments[side])
  // A fallen fighter keeps one key from the killing blow on, so the faint plays once and is not restarted by the steps after it.
  const motionKey = actor.health <= 0 ? `faint:${floor}` : classes ? state.serial : 'rest'
  return `<div class="battle-frame ${side}-frame rank-${rank}" data-key="${side}-frame:${floor}"><div class="frame-motion ${classes}" data-key="${side}-motion:${motionKey}">${art(kit, image, label)}</div><div class="frame-glow ${glow}" data-key="${side}-glow:${glow ? state.serial : 'rest'}"></div>${pops(moments[side], state.serial)}<div class="platform"></div></div>`
}

function gearStrip(kit, gear) {
  return gear.map(entry => `<span class="gear-chip">${art(kit, entry.type, rules.catalog.items[entry.type].name)}<b>${entry.level}</b></span>`).join('')
}

/**
 * Who stands on the stage, as plain facts: `{ key, idle, hero: fighter, foe: fighter }`, where a fighter is
 * `{ portrait, title, tag, rank, meter, gear: [{ type, level }], showNumbers }`. `key` changes when a new fight begins,
 * which replays the portraits' entrance; `meter` is a 0–100 share or null.
 */
function plate(kit, fighter, actor, moment, serial, side) {
  const meter = fighter.meter === null ? '' : `<div class="xp-line"><b>EMB</b><div class="xp-bar"><i style="width:${fighter.meter}%"></i></div></div>`
  const numbers = fighter.showNumbers ? `<div class="hp-numbers">${Math.max(0, actor.health)} / ${actor.maxHealth}</div>` : ''
  const gear = fighter.gear.length ? `<div class="gear-strip">${gearStrip(kit, fighter.gear)}</div>` : ''
  return `<div class="battle-plate ${side}-plate"><div class="plate-name"><strong>${escape(fighter.title.toUpperCase())}</strong><small>${escape(fighter.tag)}</small></div><div class="pills">${statusPills(actor)}</div>${hpBar(actor, moment, serial)}${numbers}${meter}${gear}</div>`
}

/** The cast of a Descent floor: the crew member below, the floor's enemy above. */
export function descentCast(state) {
  const journey = state.journey, run = journey.descent, crew = descentCrew[run.crew]
  const need = embersNeeded(run.level + run.pendingLevels)
  return {
    key: run.floor,
    idle: state.message || (journey.battle.started ? journey.message : `${run.story.at(-1) ?? ''} What will ${crew.name} do?`),
    hero: { portrait: crew.portrait, title: crew.name, tag: `LV ${run.level}`, rank: 'hero', meter: percent(run.embers, need), showNumbers: true,
      gear: placedItems(journey.battle).map(item => ({ type: item.type, level: run.items[item.id]?.level ?? 1 })) },
    foe: { portrait: run.enemy.portrait, title: journey.battle.actors.enemy.name, tag: crest[run.enemy.kind] || `FLOOR ${run.floor}`, rank: run.enemy.kind, meter: null, showNumbers: false, gear: [] }
  }
}

/** The whole stage: both fighters, their plates, the effects of the current step and the battle box. */
export function battleStage(kit, state, cast) {
  const journey = state.journey, battle = journey.battle
  const hero = battle.actors.recruit, foe = battle.actors.enemy
  const moments = stepMoments(state.step)
  const isQuake = ['recruit', 'enemy'].some(id => moments[id].hit >= battle.actors[id].maxHealth * QUAKE_SHARE)
  const line = battleLine(state.step)
  // Quiet steps (cycle start, planning) keep the last line on screen instead of flashing back to the idle text.
  const held = !line && battle.started && state.battleLine ? state.battleLine : null
  const boxKey = line ? state.serial : held ? held.serial : `idle:${cast.key}:${journey.phase}`
  const box = `<div class="battle-box" data-key="box:${boxKey}"><p class="${line || held ? 'typing' : ''}">${escape(line || held?.text || cast.idle)}</p><span class="box-cursor">▼</span></div>`
  // The field is never re-keyed: replacing it would rebuild both portraits and replay their entrance.
  // Two identical shakes alternate by step, so back-to-back big hits each restart the shake.
  return `<div class="battle-field ${isQuake ? `quake-${state.serial % 2}` : ''}">${plate(kit, cast.foe, foe, moments.enemy, state.serial, 'foe')}${portrait(kit, 'enemy', cast.foe.portrait, foe.name, foe, moments, state, cast.key, cast.foe.rank)}${portrait(kit, 'recruit', cast.hero.portrait, hero.name, hero, moments, state, cast.key, cast.hero.rank)}${plate(kit, cast.hero, hero, moments.recruit, state.serial, 'hero')}</div>${box}`
}
