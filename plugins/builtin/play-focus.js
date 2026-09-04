/**
 * Play Focus — playing should feel like playing, not like using an editor.
 *
 * Pressing play used to leave the game in a small letterboxed viewport with four
 * docks around it, a toolbar above and a test list below. The game was about a
 * third of the window, and a panel was one stray click away mid-round.
 *
 * So: when play starts the frame collapses to the viewport and the browser's own
 * chrome goes with it; when play stops the editor comes back exactly as it was.
 *
 * The split. `shell.focus(on)` is the kernel's — the frame lives in
 * `engine/shell.js`, so knowing *how* to get out of the way lives there, and a
 * plugin may not write markup so it could not restructure the frame anyway. This
 * file owns the policy: *when* that happens, what Escape means, and what to say
 * when the browser refuses. The kernel owns the vocabulary; a plugin spends it.
 *
 * What Escape means, written down because the two halves have to agree.
 * Escape both drops pointer lock and leaves full screen, and a shooter's
 * answer is that Escape opens a menu and the round carries on. So:
 *
 *   first press    the browser hands the mouse back. Still playing, still full
 *                  screen, cursor now over the STOP button. That is the menu.
 *   second press   the browser leaves full screen. `fullscreenchange` fires and
 *                  the docks come back, so the editor is never left half
 *                  collapsed inside a windowed page. Still playing.
 *   STOP           the only thing that stops play, and it is on screen the whole
 *                  time.
 *
 * Nothing here stops the world. A round that ends because you wanted your mouse
 * back is the surprise this ordering exists to avoid.
 */

/**
 * The live surface, published on the module.
 *
 * A test is handed a `test` object and no context, and every decision here is
 * made against `context.shell`. Reading the real one through this rather than
 * rebuilding a second copy is the point — a test with its own idea of the state
 * would pass while the state the game uses was wrong.
 */
export const playFocus = {
  context: null,    // the live context, filled in at load
  wanted: false,    // what the policy last asked for
  fullscreen: false // whether the browser actually granted the whole screen
}

/** What has already been said out loud, by kind, so a repeat is quiet. */
const said = new Set()

/** The last reason focus or full screen is not what was asked for, in words. */
let why = null

const ESCAPE_MEANS =
  'Escape gives the mouse back and the round carries on; pressing it again leaves full screen and brings the editor back. Only STOP stops play.'

/**
 * Say a refusal by name, once per kind. Silence is the enemy, but a browser
 * answers one refused request twice — a rejected promise and a `fullscreenerror`
 * event — and an agent that plays from a terminal fifty times would get fifty
 * copies of the same advice. That is its own kind of silence: it buries the
 * lines that matter. So the console gets the first one and `why` always carries
 * the latest, which `play.focus` reports on demand.
 */
function say(kind, message) {
  why = message
  if (said.has(kind)) return
  said.add(kind)
  console.error(`[play-focus] ${message}`)
}

/**
 * Collapse the frame, or put it back, and take the browser chrome with it.
 *
 * Exported so a test can drive the policy directly against whatever `context.shell`
 * is at the time, with no screen and no click involved.
 */
export function applyFocus(context, on) {
  const wanted = !!on
  playFocus.wanted = wanted
  // Cleared first, so whatever the report says afterwards is about this attempt
  // and not about one three rounds ago.
  why = null

  const shell = context?.shell
  if (!shell?.focus) {
    // Not a failure. A world with no screen runs every rule above this line and
    // simply has no docks to collapse, and that is the case several agents work
    // in at once — so it is recorded rather than shouted about.
    why = 'there is no shell in this world, so there are no docks to collapse — nothing is drawing'
    return describeFocus(context)
  }

  shell.focus(wanted)
  if (wanted) askForFullScreen(context)
  else leaveFullScreen()
  return describeFocus(context)
}

/**
 * Ask for the whole screen.
 *
 * The browser only grants this from inside a user gesture. The gesture is the
 * click on PLAY: `editor.togglePlay` emits `play:started` synchronously from the
 * button's own handler, so the listener below is still inside it. Starting play
 * from a terminal is not a gesture and the request is refused — which is why the
 * refusal says what to press instead, and why the FOCUS toolbar button exists.
 */
function askForFullScreen(context) {
  if (typeof document === 'undefined') {
    why = 'there is no document, so there is no full screen to ask for'
    return
  }
  const root = context?.shell?.root
  if (!root?.requestFullscreen) {
    why = 'this browser has no Fullscreen API on the shell root, so the game fills the page but not the screen'
    return
  }
  if (document.fullscreenElement) return

  try {
    // navigationUI: 'hide' asks for the whole screen rather than a screen with a
    // toolbar left on it. Browsers that do not know the option ignore it.
    const request = root.requestFullscreen({ navigationUI: 'hide' })
    if (request?.catch) request.catch(refused)
  } catch (error) {
    refused(error)
  }
}

const refused = reason => say('refused',
  `the browser refused full screen (${reason?.message || reason || 'no reason given'}). ` +
  'The docks are collapsed so the game fills the page, but the browser\'s own chrome is still there. ' +
  'Full screen is only granted from a real click, so press PLAY in the toolbar rather than starting play from a terminal, or press FOCUS in the toolbar while the game is running. F11 does the same thing by hand.')

const stuck = reason => say('stuck',
  `the browser refused to leave full screen (${reason?.message || reason || 'no reason given'}). The docks are back but the window is not — press Escape.`)

function leaveFullScreen() {
  if (typeof document === 'undefined') return
  if (!document.fullscreenElement || !document.exitFullscreen) return
  try {
    const leaving = document.exitFullscreen()
    // Refusing to *leave* full screen is rare and would strand the editor inside
    // it, so it is worth a line rather than a swallowed promise.
    if (leaving?.catch) leaving.catch(stuck)
  } catch (error) {
    stuck(error)
  }
}

/** Whether focus and full screen are on, and why not. */
export function describeFocus(context) {
  const shell = context?.shell
  const focused = shell?.focused === true
  const fullscreen = typeof document !== 'undefined' && !!document.fullscreenElement
  playFocus.fullscreen = fullscreen

  // A request that was neither granted nor rejected still has to read as
  // something. The request is made and answered a moment later, so this is what
  // the report says in between — and what it keeps saying if the answer never
  // comes, which is the case that would otherwise be silent.
  const pending = playFocus.wanted && focused && !fullscreen && !why
    ? 'the browser has not granted full screen. It is only granted from a real click, so press PLAY or FOCUS in the toolbar; F11 does the same by hand.'
    : why

  return {
    focused,
    wanted: playFocus.wanted,
    fullscreen,
    screen: !!shell,
    playing: context?.loop?.running === true,
    // Only ever a reason something is *not* on. Nothing is wrong when nothing
    // was asked for, and a report that always carries a complaint teaches you to
    // stop reading it.
    why: playFocus.wanted && !(focused && fullscreen) ? pending : null,
    escape: ESCAPE_MEANS
  }
}

export default {
  name: 'Play Focus',

  category: 'editor',
  onLoad(context) {
    playFocus.context = context

    // The policy, and the whole of it: play decides, the shell obeys.
    context.bus.on('play:started', () => applyFocus(context, true))
    context.bus.on('play:stopped', () => applyFocus(context, false))

    if (typeof document === 'undefined') return

    document.addEventListener('fullscreenchange', () => {
      const on = !!document.fullscreenElement
      playFocus.fullscreen = on
      if (on) { why = null; return }
      // Escape or F11 left full screen. Put the docks back rather than leaving a
      // collapsed editor sitting inside a windowed page with no way to reach a
      // panel — but do not stop play. See the note at the top of this file:
      // Escape opens a menu, the round carries on.
      if (playFocus.wanted) {
        playFocus.wanted = false
        context.shell?.focus(false)
        why = null
      }
    })

    document.addEventListener('fullscreenerror', () => refused('fullscreenerror'))
  },

  menus: [{
    id: 'play.focus.toggle',
    label: 'FOCUS',
    title: 'Fill the screen — the docks come back exactly as they were',
    on: context => context.shell?.focused === true,
    // A toolbar click is a real user gesture, so this is also the way back into
    // full screen after play was started from a terminal, or after Escape.
    run: context => { applyFocus(context, !(context.shell?.focused === true)) }
  }],

  commands: [{
    id: 'play.focus',
    label: 'Whether the game fills the screen, and why not',
    // args: nothing to read it, true or false to set it by hand
    run(context, wanted) {
      if (wanted === undefined || wanted === null) return describeFocus(context)
      return applyFocus(context, wanted === true || wanted === 'true')
    }
  }]
}
