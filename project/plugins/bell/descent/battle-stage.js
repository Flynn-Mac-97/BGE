/**
 * The Descent battle stage, laid out like a handheld monster battle: the enemy's framed portrait top right
 * with its nameplate, the hero bottom left with HP and Embers, and a battle text box. Each resolved step
 * plays short CSS effects (lunge, hit blink, HP drain, pop-ups, faint), keyed by the step so each plays once.
 */
import { art } from '../art.js'
import { rules, itemDefinition } from '../rules.js'
import { escape } from '../inspection.js'
import { statusText } from '../glance.js'
import { placedItems } from '../../grid-game/grid.js'
import { descentCrew } from './pool.js'
import { embersNeeded } from './run.js'

const crest = { normal: '', elite: '◆ ELITE', boss: '♛ BOSS' }
// A hit that takes this share of max health or more shakes the whole stage.
const QUAKE_SHARE = 0.25

const nameOf = (battle, subject) => subject.kind === 'item' ? itemDefinition(battle, subject.id).name : battle.actors[subject.id].name
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

function gearStrip(kit, journey) {
  return placedItems(journey.battle).map(item => `<span class="gear-chip">${art(kit, item.type, itemDefinition(journey.battle, item.id).name)}<b>${journey.descent.items[item.id]?.level ?? 1}</b></span>`).join('')
}

/** The whole stage for a Descent journey: both fighters, their plates, the effects of the current step and the battle box. */
export function battleStage(kit, state) {
  const journey = state.journey, run = journey.descent, battle = journey.battle
  const crew = descentCrew[run.crew]
  const hero = battle.actors.recruit, foe = battle.actors.enemy
  const moments = stepMoments(state.step)
  const isQuake = ['recruit', 'enemy'].some(id => moments[id].hit >= battle.actors[id].maxHealth * QUAKE_SHARE)
  const line = battleLine(state.step)
  // Quiet steps (cycle start, planning) keep the last line on screen instead of flashing back to the floor text.
  const held = !line && battle.started && state.battleLine ? state.battleLine : null
  const idle = state.message || (battle.started ? journey.message : `${run.story.at(-1) ?? ''} What will ${crew.name} do?`)
  const need = embersNeeded(run.level + run.pendingLevels)
  const foePlate = `<div class="battle-plate foe-plate"><div class="plate-name"><strong>${escape(foe.name.toUpperCase())}</strong><small>${crest[run.enemy.kind] || `FLOOR ${run.floor}`}</small></div><div class="pills">${statusPills(foe)}</div>${hpBar(foe, moments.enemy, state.serial)}</div>`
  const heroPlate = `<div class="battle-plate hero-plate"><div class="plate-name"><strong>${escape(crew.name.toUpperCase())}</strong><small>LV ${run.level}</small></div><div class="pills">${statusPills(hero)}</div>${hpBar(hero, moments.recruit, state.serial)}<div class="hp-numbers">${Math.max(0, hero.health)} / ${hero.maxHealth}</div><div class="xp-line"><b>EMB</b><div class="xp-bar"><i style="width:${percent(run.embers, need)}%"></i></div></div><div class="gear-strip">${gearStrip(kit, journey)}</div></div>`
  const boxKey = line ? state.serial : held ? held.serial : `idle:${run.floor}:${journey.phase}`
  const box = `<div class="battle-box" data-key="box:${boxKey}"><p class="${line || held ? 'typing' : ''}">${escape(line || held?.text || idle)}</p><span class="box-cursor">▼</span></div>`
  return `<div class="battle-field ${isQuake ? 'quake' : ''}" data-key="field:${isQuake ? state.serial : 'calm'}">${foePlate}${portrait(kit, 'enemy', run.enemy.portrait, foe.name, foe, moments, state, run.floor, run.enemy.kind)}${portrait(kit, 'recruit', crew.portrait, crew.name, hero, moments, state, run.floor, 'hero')}${heroPlate}</div>${box}`
}
