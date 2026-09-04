/**
 * Choice Screen — stop the world and make the player pick one.
 *
 * The pause is half the reward. A levelling game that offered its choice while
 * the crowd kept coming would be asking the player to read three sentences
 * under fire, and they would take the first card every time. So the world
 * genuinely stops: `loop.hold` freezes the clock while every system keeps
 * running, which means the screen still draws and the keys are still read.
 *
 *   context.choiceScreen.offer({
 *     title: 'LEVEL UP',
 *     options: [{ id: 'whip', title: 'Whip', line: 'Strikes ahead of you' }],
 *     onPick: option => ...
 *   })
 *
 * Offers **queue**. Crossing three level thresholds on one pickup has to mean
 * three choices in a row, and an offer that arrived while one was open used to
 * be the choice nobody ever saw.
 *
 * Every way in ends at `pick(index)` — the number keys, the arrows and Enter,
 * and the `choice.pick` command a terminal uses. There is no arrangement a
 * player can reach that an agent cannot.
 */

/** The number keys, bound as this plugin's own so nothing else's binding shifts. */
const PICK_KEYS = Object.fromEntries(
  [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => [`choicePick${n}`, [`Digit${n}`, `Numpad${n}`]])
)

const MOVE_KEYS = {
  choiceLeft: ['ArrowLeft', 'KeyA'],
  choiceRight: ['ArrowRight', 'KeyD'],
  choiceConfirm: ['Enter', 'Space', 'NumpadEnter']
}

const WATCHED = [...Object.keys(PICK_KEYS), ...Object.keys(MOVE_KEYS)]

/** Why the world is stopped, in a word a snapshot can print. */
const HOLD = 'choice-screen'

const CARD = { width: 320, height: 250, gap: 36, margin: 80 }

/**
 * The live screen and the key reader, published on the module.
 *
 * A contribution point is declared on the module while the state it drives is
 * made in `onLoad`, so the systems below need a way back to it. The same
 * arrangement `camera.js` and `buy-menu.js` use, and for the same reason.
 */
export const choiceScreen = { readKeys: null }

export default {
  name: 'Choice Screen',
  category: 'game',
  needs: ['Screen', 'Keyboard Input'],
  about: 'Stop the world and offer a row of cards to pick from, by number or by arrow keys.',
  inspect: context => {
    const view = context.choiceScreen?.view()
    if (!view?.open) return []
    return [{ title: view.title, rows: view.options.map((o, i) => [`${i + 1}. ${o.title}`, o.line || '']) }]
  },

  onLoad(context) {
    const input = context.input
    if (input) for (const [action, codes] of Object.entries({ ...PICK_KEYS, ...MOVE_KEYS })) input.bind(action, codes)
    else console.error('[choice-screen] Keyboard Input did not load, so no key picks a card — only context.choiceScreen.pick() and the choice.pick command will work.')

    /** Offers waiting their turn. The one being shown is the head of the queue. */
    const queue = []
    let selected = 0

    const current = () => queue[0] || null

    /** Stop time while a choice is open, and give it back the moment it is not. */
    function holdWorld(on) {
      if (on) context.loop.hold(HOLD)
      else context.loop.release(HOLD)
    }

    function view() {
      const showing = current()
      if (!showing) return { open: false, title: '', options: [], selected: -1, waiting: 0 }
      return {
        open: true,
        title: showing.title || 'Choose',
        subtitle: showing.subtitle || '',
        selected,
        waiting: queue.length - 1,
        options: showing.options.map((option, index) => ({ ...option, number: index + 1, chosen: index === selected }))
      }
    }

    /** What the screen looks like, as items the Screen plugin knows how to draw. */
    function draw() {
      const shown = view()
      if (!shown.open) return []

      const box = context.screen.box
      const count = shown.options.length
      const width = Math.min(CARD.width, (box.width - CARD.margin * 2 - CARD.gap * (count - 1)) / Math.max(count, 1))
      const items = [
        // Dark enough that the cards are the only thing to read, light enough
        // that the crowd you are about to go back to is still visible behind it.
        { dim: 0.66 },
        { text: shown.title, at: [0, 96], anchor: 'top', size: 46, weight: 800 }
      ]
      if (shown.subtitle) items.push({ text: shown.subtitle, at: [0, 152], anchor: 'top', size: 17, color: 'rgba(255,255,255,0.6)' })

      shown.options.forEach((option, index) => {
        items.push({
          card: {
            number: index + 1,
            title: option.title,
            line: option.line,
            glyph: option.glyph,
            rank: option.rank,
            tag: option.tag,
            color: option.color
          },
          at: [(index - (count - 1) / 2) * (width + CARD.gap), 16],
          anchor: 'center',
          size: [width, CARD.height],
          selected: index === shown.selected
        })
      })

      items.push({
        text: `1–${count} to take one   ←  →  and Enter`,
        at: [0, -84], anchor: 'bottom', size: 15, color: 'rgba(255,255,255,0.55)'
      })
      if (shown.waiting) {
        items.push({ text: `${shown.waiting} more to choose`, at: [0, -56], anchor: 'bottom', size: 15, color: 'rgba(255,209,102,0.9)' })
      }
      return items
    }

    /**
     * Put the next offer on screen, or take the screen down when there is none.
     * The world is held exactly as long as something is being asked.
     */
    function present() {
      const showing = current()
      selected = 0
      if (!showing) {
        holdWorld(false)
        context.screen?.hide('choice-screen')
        context.bus.emit('choice:closed')
        return
      }
      holdWorld(true)
      context.screen?.show('choice-screen', draw, { order: 100 })
      context.bus.emit('choice:offered', { title: showing.title, options: showing.options })
    }

    function offer(request) {
      const options = [].concat(request?.options || []).filter(Boolean)
      if (!options.length) {
        console.error('[choice-screen] an offer with no options was ignored — there would be nothing to pick.')
        return { ok: false, refused: 'no-options' }
      }
      queue.push({ ...request, options })
      // Only the first one presents; the rest wait their turn, which is what
      // makes three levels in one pickup three choices rather than one.
      if (queue.length === 1) present()
      return { ok: true, waiting: queue.length }
    }

    function pick(index) {
      const showing = current()
      if (!showing) return { ok: false, refused: 'closed', reason: 'nothing is being offered' }
      const option = showing.options[index]
      if (!option) return { ok: false, refused: 'no-option', reason: `there is no ${index + 1} on this list` }

      queue.shift()
      // Applied before the next offer goes up, so a pick that unlocks something
      // is already in force when the following card list is built.
      try { showing.onPick?.(option, index) }
      catch (error) { console.error('[choice-screen] the pick handler threw', error) }
      context.bus.emit('choice:picked', { option, index, title: showing.title })
      present()
      return { ok: true, id: option.id ?? null, title: option.title }
    }

    const move = step => {
      const showing = current()
      if (!showing) return
      const count = showing.options.length
      selected = (selected + step + count) % count
    }

    /**
     * `pressed`, and each press acted on once.
     *
     * A frame can hold many fixed steps and `pressed` stays true across all of
     * them, so one tap would otherwise take every card in the queue. The marks
     * are cleared on `step:end` — the same event that clears the keyboard's own
     * list, so the two can never outlive each other.
     */
    const spent = new Set()
    context.bus.on('step:end', () => spent.clear())

    function readKeys() {
      if (!current() || !input) return
      for (const action of WATCHED) {
        if (!input.pressed(action) || spent.has(action)) continue
        spent.add(action)

        if (action === 'choiceLeft') { move(-1); continue }
        if (action === 'choiceRight') { move(1); continue }
        if (action === 'choiceConfirm') { pick(selected); return }
        pick(Number(action.slice(-1)) - 1)
        return
      }
    }

    context.choiceScreen = {
      offer,
      pick,
      view,
      move,
      get isOpen() { return !!current() },
      get waiting() { return Math.max(0, queue.length - 1) },
      /** Drop everything unanswered and give the world back. Death cancels a choice. */
      cancel() {
        queue.length = 0
        present()
      }
    }
    choiceScreen.readKeys = readKeys

    // An offer left standing into the next level would hold time still forever,
    // with a card list about a run that is over.
    context.bus.on('level:loaded', () => { queue.length = 0; holdWorld(false); selected = 0 })
    context.bus.on('play:stopped', () => { queue.length = 0; holdWorld(false); selected = 0 })
  },

  systems: [{
    // Fixed, because a pick changes the game: it has to land on the same step
    // on every replay or simulate() stops repeating.
    phase: 'fixed',
    run: () => choiceScreen.readKeys?.()
  }],

  commands: [
    {
      id: 'choice.show',
      label: 'What is being offered',
      run: context => context.choiceScreen.view()
    },
    {
      id: 'choice.pick',
      label: 'Take one of the offered cards',
      // args: the number on the card, as a player would press it
      run: (context, args) => context.choiceScreen.pick(Number([].concat(args ?? [])[0] ?? 1) - 1)
    }
  ]
}
