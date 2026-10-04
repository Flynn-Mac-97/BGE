/** The engine owns time and input; rules return immutable snapshots for the game to present. */
import { createCrafter } from './bell/crafter/controller.js'
import { hire, embark, returnToTavern, rest, learn, refine, adventurers } from './bell/campaign.js'
import { companyStore } from './bell/company-save.js'
import { tavernView } from './bell/tavern-view.js'
import { rules, itemDefinition } from './bell/rules.js'
import { createJourney, finishBattle, claim, salvage, searchCache, retryRoom, descend } from './bell/loop.js'
import { createFamilyJourney, resetPractice, familyKits } from './bell/family-lab.js'
import { view } from './bell/view.js'
import { itemLinks } from './bell/inspection.js'
import { describeStep, stepDuration } from './bell/feedback.js'
import { profileStore, settleRun, buyUpgrade, unlockedCrew } from './bell/descent/profile-save.js'
import { createRun, finishFloor, chooseCard, rerollCards, collectChest, abandonRun, readyItem, armReadied } from './bell/descent/run.js'
import { hubView } from './bell/descent/view.js'
import { battleLine } from './bell/descent/battle-stage.js'
import { descentCrew } from './bell/descent/pool.js'
import { forgeItem, forgeArt, forgeName } from './bell/descent/forge.js'
import { forgeView, forgeDraft, pickForgePart } from './bell/descent/forge-view.js'
import { createDuel, canPlaceDraft, nextHero, readyDraft, takeHandoff, finishDuel, rateDuel, fightAgain, redraft } from './bell/duel/duel.js'
import { startingRules, nextRule } from './bell/duel/duel-rules.js'
import { duelRulesView } from './bell/duel/view.js'
import { playLogView, playLogText } from './bell/descent/play-log.js'
const sessions = new WeakMap()
/** The hub's first line: a welcome, or the last result. */
const hubWelcome = profile => profile.runs ? `The Last Lantern. ${profile.runs} run${profile.runs === 1 ? '' : 's'} so far; the deepest reached floor ${profile.bestFloor}. The stair waits.` : 'The Last Lantern, at the top of a stair that has no bottom. Choose who goes down. Whatever they find, the Bells they bring back stay with you.'

export default {
  name: 'Black Bell Prototype', category: 'game', needs: ['Game UI', 'Black Bell Grid'],
  onLoad(context) {
    let storage = context.companyStorage
    if (!storage) try { storage = globalThis.window?.localStorage } catch {}
    const saves = companyStore(storage), company = saves.load()
    const profiles = profileStore(storage), profile = profiles.load()
    const state = { profile, crewSelected: 'rook', forgeDraft: forgeDraft(), forgeNotice: '', duelRules: startingRules(), hubNotice: hubWelcome(profile), company, screen: 'hub', tavernSelected: Object.keys(company.roster)[0] ?? 'rook', saveWarning: saves.warning(), journey: company.active ?? createJourney(), selected: null, moving: false, expanded: false, link: null, queue: [], step: null, log: [], paused: false, menu: false, history: false, slow: false, auto: true, left: 0, serial: 0, message: '' }
    let html = ''
    let savedJourney = null
    let savedAuto = true
    let savedScreen = 'expedition'
    let craftReturn = 'tavern'
    const crafter = createCrafter(context.gameUi.kit, storage, () => redraw(), () => { state.screen = craftReturn; redraw() })
    const redraw = () => {
      if (state.company.active && !state.journey.sandbox && !state.journey.duel && !state.journey.descent && state.screen === 'expedition') state.company.active = state.journey
      if (state.journey.descent && state.screen === 'expedition') {
        state.profile.journey = state.journey
        const banked = settleRun(state.profile, state.journey)
        if (banked) state.hubNotice = `${descentCrew[state.journey.descent.crew].name} reached floor ${state.journey.descent.floor} and brought back ${banked} Bells.`
      }
      if (!state.queue.length) { saves.save(state.company); profiles.save(state.profile) }
      state.saveWarning = profiles.warning() || saves.warning()
      html = screens[state.screen]()
    }
    const screens = {
      crafter: () => crafter.view(),
      tavern: () => tavernView(context.gameUi.kit, state),
      hub: () => hubView(context.gameUi.kit, state),
      forge: () => forgeView(context.gameUi.kit, state),
      duelRules: () => duelRulesView(context.gameUi.kit, state),
      playLog: () => playLogView(context.gameUi.kit, state),
      expedition: () => view(context.gameUi.kit, state)
    }
    const closeInspection = () => { state.selected = null; state.moving = false; state.expanded = false; state.link = null }
    const editable = () => state.screen === 'expedition' && !state.queue.length && state.journey.phase === 'battle' && state.journey.battle.phase === 'planning'
    const clearPresentation = () => { state.queue = []; state.step = null; state.battleLine = null; state.log = []; state.paused = false; state.menu = false; state.history = false; state.message = ''; state.left = 0; closeInspection() }
    // The closing marker settles the cycle only after the last step has had its full time on screen,
    // so a killing blow and its faint are seen before any reward screen covers them.
    const queueCycle = () => { armReadied(state.journey); state.queue = [...rules.resolveCycle(state.journey.battle, { afterCycle: ['enemy'] }).trace, { kind: 'settle' }] }
    const settle = () => {
      const finish = state.journey.duel ? finishDuel : state.journey.descent ? finishFloor : finishBattle
      if (finish(state.journey, () => context.random())) { state.paused = false; closeInspection(); state.message = ''; state.step = null; state.battleLine = null }
      else if (state.auto) queueCycle()
      else state.paused = false
    }
    const advance = () => {
      const step = state.queue.shift()
      if (!step) return
      if (step.kind === 'settle') { settle(); redraw(); return }
      state.journey.battle = step.state
      state.step = step
      const line = battleLine(step)
      if (line) state.battleLine = { text: line, serial: state.serial + 1 }
      state.message = describeStep(step)
      state.log.push(state.message)
      if (state.log.length > 100) state.log.shift()
      state.serial++; state.left = stepDuration(step, state.slow ? 'slow' : 'normal')
      redraw()
    }
    const actions = {
      ...crafter.actions,
      openCrafter() { if (state.queue.length) return; craftReturn = state.screen; state.screen = 'crafter'; state.menu = false; redraw() },
      patron(id) { if (adventurers[id]) { state.tavernSelected = id; redraw() } },
      hire(id) { if (hire(state.company, id)) { state.tavernSelected = id; redraw() } },
      embark(id) { const journey = embark(state.company, id); if (journey) { state.journey = journey; state.screen = 'expedition'; clearPresentation(); redraw() } },
      returnTavern() { if (!state.queue.length && returnToTavern(state.company, state.journey)) { state.tavernSelected = state.journey.expedition.recruit; state.screen = 'tavern'; clearPresentation(); redraw() } },
      resumeExpedition() { if (state.company.active) { state.journey = state.company.active; state.screen = 'expedition'; clearPresentation(); redraw() } },
      rest(id) { if (rest(state.company, id)) redraw() },
      learn(trait) { if (learn(state.company, state.tavernSelected, trait)) redraw() },
      refine(id) { if (refine(state.company, state.tavernSelected, id)) redraw() },
      hub() { if (!state.queue.length) { state.screen = 'hub'; clearPresentation(); redraw() } },
      oldCompany() { if (state.company.active) state.journey = state.company.active; state.screen = state.company.active ? 'expedition' : 'tavern'; redraw() },
      openLab() { actions.family('thorn') },
      crew(id) { if (descentCrew[id]) { state.crewSelected = id; redraw() } },
      goDown(id) {
        if (state.profile.journey || !unlockedCrew(state.profile).includes(id)) return
        state.journey = createRun(state.profile, id, () => context.random()); state.screen = 'expedition'; clearPresentation(); redraw()
      },
      openForge() { state.screen = 'forge'; state.forgeNotice = ''; redraw() },
      forgePart(value) { const [part, id] = String(value).split(':'); state.forgeDraft = pickForgePart(state.forgeDraft, part, id); state.forgeNotice = ''; redraw() },
      forgeArt() { state.forgeDraft = { ...state.forgeDraft, art: forgeArt[(forgeArt.indexOf(state.forgeDraft.art) + 1) % forgeArt.length] }; redraw() },
      forgeBuy() {
        const record = forgeItem(state.profile, state.forgeDraft)
        state.forgeNotice = record ? `The anvil rings. ${forgeName(record)} is yours: it can drop in the Descent and stands on the Duel Pit shelf.` : 'The forge cannot make that now.'
        redraw()
      },
      openLog() { state.screen = 'playLog'; state.logNotice = ''; redraw() },
      copyLog() {
        const copied = () => { state.logNotice = 'Copied. Paste it into the chat.'; redraw() }
        const failed = () => { state.logNotice = 'This device would not copy. Long-press the text, Select all, then Copy.'; redraw() }
        // The clipboard is outside the game, so a refusal is expected on some devices.
        try { globalThis.navigator.clipboard.writeText(playLogText(state.profile)).then(copied, failed) } catch { failed() }
      },
      openDuel() { if (!state.queue.length) { state.screen = 'duelRules'; clearPresentation(); redraw() } },
      duelRule(id) { state.duelRules = nextRule(state.duelRules, id); redraw() },
      duelStart() { state.journey = createDuel(state.duelRules, state.profile.forged.map(record => record.id), () => context.random()); state.screen = 'expedition'; state.auto = true; clearPresentation(); redraw() },
      duelReady() { if (!state.queue.length && readyDraft(state.journey)) { clearPresentation(); redraw() } },
      duelHandoff() { if (takeHandoff(state.journey)) { clearPresentation(); redraw() } },
      duelHero() { if (nextHero(state.journey)) redraw() },
      duelRate(value) { if (rateDuel(state.profile, state.journey, Number(value))) redraw() },
      duelAgain() { if (!state.queue.length && fightAgain(state.journey)) { clearPresentation(); redraw() } },
      duelRedraft() { if (!state.queue.length && redraft(state.journey)) { clearPresentation(); redraw() } },
      leaveDuel() { if (state.journey.duel) { state.journey = createJourney(); actions.openDuel() } },
      useItem(id) { if (readyItem(state.journey, id)) { state.message = `${itemDefinition(state.journey.battle, id).name} readied: it acts at the start of the next cycle.`; redraw() } },
      continueRun() { if (state.profile.journey) { state.journey = state.profile.journey; state.screen = 'expedition'; clearPresentation(); redraw() } },
      buy(id) { if (buyUpgrade(state.profile, id)) { state.hubNotice = `The ${id === 'deepPockets' ? 'tower' : 'bell'} rings. ${state.profile.bells} Bells left.`; redraw() } },
      card(index) { if (!state.queue.length && chooseCard(state.journey, Number(index), () => context.random())) { closeInspection(); redraw() } },
      reroll() { if (rerollCards(state.journey, () => context.random())) redraw() },
      chest() { if (collectChest(state.journey, () => context.random())) redraw() },
      abandon() {
        const journey = state.journey.descent ? state.journey : state.profile.journey
        if (!journey || state.queue.length || !abandonRun(journey)) return
        state.journey = journey; state.screen = 'expedition'; state.menu = false; redraw()
      },
      lantern() { if (state.journey.phase === 'dead') { state.profile.journey = null; state.journey = createJourney(); state.screen = 'hub'; clearPresentation(); redraw() } },
      family(value) {
        if (!familyKits[value] || (!state.journey.sandbox && state.queue.length)) return
        if (!state.journey.sandbox) { savedJourney = state.journey; savedAuto = state.auto; savedScreen = state.screen }
        state.journey = createFamilyJourney(value); state.screen = 'expedition'; clearPresentation(); state.auto = false; redraw()
      },
      practiceReset() { if (resetPractice(state.journey)) { clearPresentation(); redraw() } },
      leaveLab() { if (savedJourney) { state.journey = savedJourney; state.screen = savedScreen; state.auto = savedAuto; savedJourney = null; clearPresentation(); redraw() } },
      select(id) {
        if (!state.journey.battle.items[id]) return
        closeInspection(); state.selected = id
        state.moving = editable() && !state.journey.battle.items[id].position
        if (state.moving) state.message = itemDefinition(state.journey.battle, id).storage ? 'Tap the + slot on the right to attach this pack.' : 'Tap the top-left destination cell. The full footprint must fit.'
        redraw()
      },
      cell(value) {
        const battle = state.journey.battle
        // A duel fight board shows both grids; cells past the first grid are Player 2's.
        const columns = state.journey.duel?.rules.columns ?? battle.grid.columns, size = columns * battle.grid.rows
        const sides = state.journey.duel && state.journey.duel.stage !== 'draft' ? 2 : 1
        const index = Number(value)
        if (!Number.isInteger(index) || index < 0 || index >= size * sides) return
        const cell = index % size, owner = sides === 2 ? (index < size ? 'recruit' : 'enemy') : null
        const position = [cell % columns, Math.floor(cell / columns)]
        if (!state.moving) {
          const item = Object.values(battle.items).find(item => (!owner || item.owner === owner) && item.position && rules.cells(battle, item.id).some(cell => cell[0] === position[0] && cell[1] === position[1]))
          closeInspection(); state.selected = item?.id ?? null; redraw(); return
        }
        if (!editable()) return
        if (!canPlaceDraft(state.journey, state.selected)) { state.message = `The rules allow ${state.journey.duel.rules.items} items. Take one off first.`; redraw(); return }
        if (!rules.place(battle, state.selected, position)) state.message = 'Does not fit. Check overlap and storage support.'
        else { state.message = `${itemDefinition(battle, state.selected).name} equipped.`; closeInspection(); state.step = null }
        redraw()
      },
      snap(id) {
        id = id || state.selected
        const battle = state.journey.battle
        if (!editable() || !battle.items[id] || !itemDefinition(battle, id).storage || battle.items[id].position) return
        if (rules.place(battle, id, [battle.grid.columns, 0])) { state.message = 'Pack attached. Place items inside its outlined grid.'; closeInspection(); state.step = null }
        else state.message = 'Cannot attach: the grid limit is 12 columns.'
        redraw()
      },
      deselect() { closeInspection(); redraw() },
      details() { if (state.selected) { state.expanded = !state.expanded; state.moving = false; redraw() } },
      move() { if (state.selected && editable()) { state.moving = !state.moving; state.expanded = false; state.link = null; redraw() } },
      link(id) { if (state.selected && itemLinks(state.journey.battle, state.selected).some(link => link.id === id)) { state.link = state.link === id ? null : id; redraw() } },
      remove() { if (state.selected && editable()) { if (rules.place(state.journey.battle, state.selected, null)) { closeInspection(); state.step = null; state.message = 'Returned to reserve.' } else state.message = 'Empty this pack and detach packs to its right first.'; redraw() } },
      salvage() { if (!state.journey.sandbox && state.selected && editable()) { if (salvage(state.journey, state.selected)) closeInspection(); state.message = ''; state.step = null; redraw() } },
      cache() { if (!state.journey.sandbox && editable() && searchCache(state.journey, () => context.random())) { closeInspection(); state.message = ''; redraw() } },
      descend() { if (!state.queue.length && descend(state.journey)) { clearPresentation(); redraw() } },
      claim(type) { if (!state.queue.length && claim(state.journey, type)) { clearPresentation(); redraw() } },
      fight() { if (editable() && (!state.journey.duel || state.journey.duel.stage === 'fight')) { closeInspection(); state.log = []; state.battleLine = null; state.paused = false; queueCycle(); advance() } },
      pause() { if (state.queue.length) { state.paused = !state.paused; redraw() } },
      step() { if (state.paused && !state.expanded && !state.menu && !state.history) advance() },
      auto(value) { state.auto = !!value; redraw() },
      slow(value) { state.slow = !!value; redraw() },
      menu() { state.menu = !state.menu; state.history = false; redraw() },
      history() { state.history = !state.history; state.menu = false; redraw() },
      retry() { if (state.journey.expedition) { actions.returnTavern(); return } if (!state.queue.length && (state.journey.sandbox ? resetPractice(state.journey) : retryRoom(state.journey))) { clearPresentation(); redraw() } },
      reset() {
        if (state.journey.sandbox) { actions.leaveLab(); return }
        if (state.company.active) { state.journey.phase = 'defeat'; state.journey.battle.phase = 'planning'; returnToTavern(state.company, state.journey) }
        savedJourney = null; state.journey = createJourney(); state.screen = 'tavern'; clearPresentation(); redraw()
      }
    }
    context.bellCrafter = crafter
    context.blackBell = { read: () => structuredClone(state), action: (name, value) => { if (!actions[name]) throw new Error('Unknown Black Bell action ' + name); actions[name](value); return context.blackBell.read() } }
    sessions.set(context, { state, advance })
    context.bus.on('play:started', () => { redraw(); context.gameUi.show('black-bell', { html: () => html, on: actions }) })
  },
  commands: [
    { id: 'bell.crafter', title: 'Read concept crafter', run: context => context.bellCrafter.read() },
    { id: 'bell.read', title: 'Read Black Bell run', run: context => context.blackBell.read() },
    { id: 'bell.action', title: 'Act in Black Bell', run: (context, request) => context.blackBell.action(request.action, request.value) }
  ],
  systems: [{ phase: 'fixed', run(world, seconds, context) {
    const session = sessions.get(context)
    if (!session?.state.queue.length || session.state.paused || session.state.menu || session.state.history || session.state.expanded) return
    session.state.left -= seconds
    if (session.state.left <= 0) session.advance()
  } }]
}
