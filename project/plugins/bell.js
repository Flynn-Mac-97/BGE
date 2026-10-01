/** The engine owns time and input; rules return immutable snapshots for the game to present. */
import { rules, itemDefinition } from './bell/rules.js'
import { createJourney, finishBattle, claim, salvage, searchCache, retryRoom } from './bell/loop.js'
import { view } from './bell/view.js'
import { itemLinks } from './bell/inspection.js'
import { describeStep } from './bell/feedback.js'
const sessions = new WeakMap()

export default {
  name: 'Black Bell Prototype', category: 'game', needs: ['Game UI', 'Black Bell Grid'],
  onLoad(context) {
    const state = { journey: createJourney(), selected: null, moving: false, expanded: false, link: null, queue: [], step: null, log: [], paused: false, menu: false, history: false, slow: false, auto: true, left: 0, serial: 0, message: '' }
    let html = ''
    const redraw = () => { html = view(context.gameUi.kit, state) }
    const closeInspection = () => { state.selected = null; state.moving = false; state.expanded = false; state.link = null }
    const editable = () => !state.queue.length && state.journey.phase === 'battle' && state.journey.battle.phase === 'planning'
    const clearPresentation = () => { state.queue = []; state.step = null; state.log = []; state.paused = false; state.menu = false; state.history = false; state.message = ''; state.left = 0; closeInspection() }
    const queueCycle = () => { state.queue = rules.resolveCycle(state.journey.battle, { afterCycle: ['enemy'] }).trace }
    const advance = () => {
      const step = state.queue.shift()
      if (!step) return
      state.journey.battle = step.state
      state.step = step
      state.message = describeStep(step)
      state.log.push(state.message)
      if (state.log.length > 100) state.log.shift()
      state.serial++; state.left = state.slow ? 0.8 : 0.22
      if (!state.queue.length) {
        if (finishBattle(state.journey, () => context.random())) { state.paused = false; closeInspection(); state.message = '' }
        else if (state.auto) queueCycle()
        else state.paused = false
      }
      redraw()
    }
    const actions = {
      select(id) {
        if (!state.journey.battle.items[id]) return
        closeInspection(); state.selected = id
        state.moving = editable() && !state.journey.battle.items[id].position
        if (state.moving) state.message = 'Tap the top-left destination cell. The full footprint must fit.'
        redraw()
      },
      cell(value) {
        const battle = state.journey.battle
        const cell = Number(value)
        if (!Number.isInteger(cell) || cell < 0 || cell >= battle.grid.columns * battle.grid.rows) return
        const position = [cell % battle.grid.columns, Math.floor(cell / battle.grid.columns)]
        if (!state.moving) {
          const item = Object.values(battle.items).find(item => rules.cells(battle, item.id).some(cell => cell[0] === position[0] && cell[1] === position[1]))
          closeInspection(); state.selected = item?.id ?? null; redraw(); return
        }
        if (!editable()) return
        if (!rules.place(battle, state.selected, position)) state.message = 'Does not fit. Occupied cells cannot overlap.'
        else { state.message = `${itemDefinition(battle, state.selected).name} equipped.`; closeInspection(); state.step = null }
        redraw()
      },
      deselect() { closeInspection(); redraw() },
      details() { if (state.selected) { state.expanded = !state.expanded; state.moving = false; redraw() } },
      move() { if (state.selected && editable()) { state.moving = !state.moving; state.expanded = false; state.link = null; redraw() } },
      link(id) { if (state.selected && itemLinks(state.journey.battle, state.selected).some(link => link.id === id)) { state.link = state.link === id ? null : id; redraw() } },
      remove() { if (state.selected && editable()) { rules.place(state.journey.battle, state.selected, null); closeInspection(); state.step = null; state.message = 'Returned to reserve.'; redraw() } },
      salvage() { if (state.selected && editable()) { if (salvage(state.journey, state.selected)) closeInspection(); state.message = ''; state.step = null; redraw() } },
      cache() { if (editable() && searchCache(state.journey, () => context.random())) { closeInspection(); state.message = ''; redraw() } },
      claim(type) { if (!state.queue.length && claim(state.journey, type)) { clearPresentation(); redraw() } },
      fight() { if (editable()) { closeInspection(); state.log = []; state.paused = false; queueCycle(); advance() } },
      pause() { if (state.queue.length) { state.paused = !state.paused; redraw() } },
      step() { if (state.paused && !state.expanded && !state.menu && !state.history) advance() },
      auto(value) { state.auto = !!value; redraw() },
      slow(value) { state.slow = !!value; redraw() },
      menu() { state.menu = !state.menu; state.history = false; redraw() },
      history() { state.history = !state.history; state.menu = false; redraw() },
      retry() { if (!state.queue.length && retryRoom(state.journey)) { clearPresentation(); redraw() } },
      reset() { state.journey = createJourney(); clearPresentation(); redraw() }
    }
    context.blackBell = { read: () => structuredClone(state), action: (name, value) => { if (!actions[name]) throw new Error('Unknown Black Bell action ' + name); actions[name](value); return context.blackBell.read() } }
    sessions.set(context, { state, advance })
    context.bus.on('play:started', () => { redraw(); context.gameUi.show('black-bell', { html: () => html, on: actions }) })
  },
  commands: [
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
